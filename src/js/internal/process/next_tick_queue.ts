function initializeNextTickQueue(process: typeof globalThis.process, nextTickQueue, drainMicrotasksFn) {
  var queue;
  var tickInitHooks;
  var process: typeof globalThis.process;
  var nextTickQueue = nextTickQueue;
  var drainMicrotasks = drainMicrotasksFn;

  const { validateFunction } = require("internal/validators");

  var setup;
  setup = () => {
    const { FixedQueue } = require("internal/fixed_queue");
    queue = new FixedQueue();
    tickInitHooks = require("internal/async_hooks_tick").tickInitHooks;

    function processTicksAndRejections() {
      var tock;
      do {
        while ((tock = queue.shift()) !== null) {
          var callback = tock.callback;
          var args = tock.args;
          var frame = tock.frame;
          var restore = $getInternalField($asyncContext, 0);
          $putInternalField($asyncContext, 0, frame);
          // No catch and no finally: what a tick throws leaves this function as it was thrown, with
          // the tick's frame still current. JSNextTickQueue::drain reports it there (so an
          // uncaughtException handler reads the tick's AsyncLocalStorage stores, as in node), puts the
          // async context back, and calls in again for the ticks after it.
          if (args === undefined) {
            callback();
          } else {
            switch (args.length) {
              case 1:
                callback(args[0]);
                break;
              case 2:
                callback(args[0], args[1]);
                break;
              case 3:
                callback(args[0], args[1], args[2]);
                break;
              case 4:
                callback(args[0], args[1], args[2], args[3]);
                break;
              default:
                callback(...args);
                break;
            }
          }
          $putInternalField($asyncContext, 0, restore);
        }

        drainMicrotasks();
      } while (!queue.isEmpty());
      // Without this, every checkpoint after the first tick calls this function to find an empty queue.
      $putInternalField(nextTickQueue, 0, 0);
    }

    $putInternalField(nextTickQueue, 0, 0);
    $putInternalField(nextTickQueue, 1, queue);
    $putInternalField(nextTickQueue, 2, processTicksAndRejections);
    setup = undefined;
  };

  function nextTick(cb, ...args) {
    validateFunction(cb, "callback");
    if (setup) {
      setup();
      process = globalThis.process;
    }
    if (process._exiting) return;

    const tock = {
      callback: cb,
      // We want to avoid materializing the args if there are none because it's
      // a waste of memory and Array.prototype.slice shows up in profiling.
      args: $argumentCount() > 1 ? args : undefined,
      frame: $getInternalField($asyncContext, 0),
    };
    if (tickInitHooks.length !== 0) {
      // node fires one TickObject init per process.nextTick() call, at
      // construction time (before the callback runs).
      const asyncHooksTick = require("internal/async_hooks_tick");
      const asyncId = asyncHooksTick.newAsyncId();
      // Snapshot: enable()/disable() from inside a hook must not affect the
      // in-flight dispatch (node stages such mutations in tmp_array until
      // the emit completes).
      const hooks = tickInitHooks.slice();
      for (let i = 0; i < hooks.length; i++) {
        try {
          hooks[i](asyncId, "TickObject", 0, tock);
        } catch (err) {
          // node: a throwing init hook is fatal (fatalError: print + exit 1),
          // never surfaced to the process.nextTick() caller. console is a
          // user-mutable global, so shield the print; exit regardless.
          try {
            console.error(
              typeof (err as Partial<Error> | null | undefined)?.stack === "string" ? (err as Error).stack : err,
            );
          } catch {}
          process.exit(1);
        }
      }
    }
    queue.push(tock);
    $putInternalField(nextTickQueue, 0, 1);
  }

  return nextTick;
}

export default initializeNextTickQueue;
