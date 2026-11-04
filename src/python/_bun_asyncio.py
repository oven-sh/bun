"""asyncio and Bun's event loop.

The loops that programs make (asyncio.run(), asyncio.new_event_loop()) are asyncio's own, unchanged. While one of them sleeps in
select(), Bun's event loop turns, so timers, promises and I/O of JavaScript go on.

This module is for code that has no loop to run in: a module that awaits at the top level, and a coroutine that JavaScript
awaits. They are tasks of one more loop, which never sleeps. Bun's event loop calls it when it has something to do.
"""

import asyncio
import heapq
import selectors
from asyncio import events, tasks

import _bun_loop
import _js
import _thread
import js


class _Looking:
    """A selector that only looks. The loop is called when there is something to see."""

    def __init__(self):
        self._selector = selectors.DefaultSelector()

    def select(self, timeout=None):
        return self._selector.select(0)

    def __getattr__(self, name):
        return getattr(self._selector, name)


class BunEventLoop(asyncio.SelectorEventLoop):
    def __init__(self):
        self._bun_turning = False
        self._bun_closing = False
        self._bun_asked = False
        self._bun_timer = None
        self._bun_thread = _thread.get_ident()
        super().__init__(_Looking())
        self._bun_timer = _bun_loop.Timer(self._bun_turn)
        self._bun_watcher = _bun_loop.Watcher(self._selector.fileno(), self._bun_turn)

    def _bun_turn(self):
        """One iteration."""
        if self._bun_turning or self.is_closed():
            return
        self._bun_asked = False
        # A loop that sleeps in select() while Bun's loop turns counts as running.
        sleeping = events._get_running_loop()
        # If it is not the loop that sleeps but a task of its, in a call that waits: a thread has one current task.
        waiting = tasks._swap_current_task(sleeping, None) if sleeping is not None else None
        events._set_running_loop(None)
        self._bun_turning = True
        try:
            self._run_forever_setup()
            try:
                self._run_once()
            finally:
                self._run_forever_cleanup()
        except BaseException:
            # SystemExit or KeyboardInterrupt, which end the program. The task that raised it has it too, and nobody will ask.
            for task in _tasks:
                if task.done() and not task.cancelled():
                    task.exception()
            raise
        finally:
            self._bun_turning = False
            events._set_running_loop(sleeping)
            if waiting is not None:
                tasks._swap_current_task(sleeping, waiting)
            self._bun_plan()

    def _bun_plan(self):
        """Tells Bun's loop when the next iteration is due, and whether there is anything to stay alive for."""
        if self._bun_timer is None or self.is_closed():
            return
        scheduled = self._scheduled
        while scheduled and scheduled[0]._cancelled:
            self._timer_cancelled_count -= 1
            heapq.heappop(scheduled)._scheduled = False
        if self._ready:
            self._bun_timer.set(0)
        elif scheduled:
            self._bun_timer.set(max(0, scheduled[0]._when - self.time()))
        else:
            self._bun_timer.cancel()
        # The pipe by which a loop wakes itself up is always there. Other threads write to it: call_soon_threadsafe().
        self._bun_watcher.keep_alive(len(self._selector.get_map()) > 1 or (bool(_tasks) and _thread._count() > 0))

    def _bun_ask(self):
        """There is something to do now, which did not come from an iteration."""
        if _thread.get_ident() != self._bun_thread:
            # call_soon_threadsafe(). Bun's loop, which belongs to the main thread, watches the selector that watches the pipe.
            super()._write_to_self()
        elif not self._bun_turning and not self._bun_asked:
            self._bun_asked = True
            js.queueMicrotask(self._bun_turn)

    def _call_soon(self, callback, args, context):
        handle = super()._call_soon(callback, args, context)
        self._bun_ask()
        return handle

    def _add_callback(self, handle):
        super()._add_callback(handle)
        self._bun_ask()

    def _write_to_self(self):
        self._bun_ask()

    def call_at(self, when, callback, *args, context=None):
        timer = super().call_at(when, callback, *args, context=context)
        if not self._bun_turning:
            self._bun_plan()
        return timer

    def _timer_handle_cancelled(self, handle):
        super()._timer_handle_cancelled(handle)
        if not self._bun_turning:
            self._bun_plan()

    def is_running(self):
        """Bun's event loop runs it, between the iterations too."""
        return not self._closed and not self._bun_closing

    def _check_running(self):
        # An iteration asks too, as it begins.
        if not self._bun_turning:
            raise RuntimeError("This event loop is already running")
        if events._get_running_loop() is not None:
            raise RuntimeError("Cannot run the event loop while another loop is running")

    def run_forever(self):
        raise RuntimeError("Bun's event loop runs this loop")

    def close(self):
        if self.is_closed():
            return
        self._bun_closing = True
        self._bun_timer.close()
        self._bun_watcher.close()
        super().close()


_loop = None
_tasks = set()


def loop():
    global _loop
    if _loop is None:
        _loop = BunEventLoop()
    return _loop


async def _await(awaitable):
    return await awaitable


# The task behind each promise that run() has made
_task_of = js.WeakMap()


def _ignore(reason=None):
    pass


def run(awaitable):
    """A JavaScript promise of what `await awaitable` gives."""
    resolvers = js.Promise.withResolvers()
    task = loop().create_task(awaitable if asyncio.iscoroutine(awaitable) else _await(awaitable))

    _tasks.add(task)

    def done(task):
        _tasks.discard(task)
        if task.cancelled():
            resolvers.reject(asyncio.CancelledError())
        elif (exception := task.exception()) is not None:
            # The traceback begins with the task stepping the coroutine, which is nothing the program wrote.
            traceback = exception.__traceback__
            while traceback is not None and traceback.tb_frame.f_globals.get("__name__") in ("asyncio.tasks", __name__):
                traceback = traceback.tb_next
            resolvers.reject(exception.with_traceback(traceback))
        else:
            resolvers.resolve(task.result())

    task.add_done_callback(done)
    _task_of.set(resolvers.promise, task)
    return resolvers.promise


def coroutine_for(promise):
    """The coroutine that a task made of a JavaScript promise runs: create_task(promise)."""
    # Whoever has the task hears of a failure.
    promise.catch(_ignore)
    return _await(promise)


def _settle(future, value, thrown):
    if future.done():
        return
    if thrown:
        future.set_exception(_js.exception_for(value))
    else:
        future.set_result(value)


def wait(promise):
    """The iterator that `await promise` runs, for a JavaScript promise."""
    loop = events.get_running_loop()

    # A coroutine that has been to JavaScript and back is awaited as the task it is, so that cancelling who waits cancels it.
    task = _task_of.get(promise)
    if task is not None and task.get_loop() is loop:
        promise.catch(_ignore)
        return task.__await__()

    future = loop.create_future()

    def settled(thrown):
        def settled(value=None):
            if not loop.is_closed():
                loop.call_soon_threadsafe(_settle, future, value, thrown)

        return settled

    promise.then(settled(False), settled(True))
    return future.__await__()
