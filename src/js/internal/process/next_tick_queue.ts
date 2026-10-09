// @ts-check
// The ticks that wait are in a ring of nodes, from `read` up to `write`, which is always free.
// The ring grows by a node when it is full, so nothing is allocated for a tick unless more are
// waiting than ever before. A ring that a burst has made larger than kMaxSize is dropped when a
// drain has used less than a quarter of it.
const kMaxSize = 1024;

class Tick {
  callback: unknown;
  args: unknown[] | undefined;
  frame: unknown;
  next: Tick;

  constructor() {
    this.callback = undefined;
    this.args = undefined;
    this.frame = undefined;
    this.next = this;
  }
}

class TickQueue {
  read: Tick;
  write: Tick;
  size: number;

  constructor() {
    this.read = this.write = new Tick();
    this.size = 1;
  }

  push(callback: unknown, args: unknown[] | undefined, frame: unknown): void {
    const tick = this.write;
    let next = tick.next;
    if (next === this.read) next = this.grow(tick);
    tick.callback = callback;
    tick.args = args;
    tick.frame = frame;
    this.write = next;
  }

  grow(after: Tick): Tick {
    const tick = new Tick();
    tick.next = after.next;
    after.next = tick;
    this.size++;
    return tick;
  }

  shrink(used: number): void {
    if (this.size > kMaxSize && used * 4 < this.size) {
      this.read = this.write = new Tick();
      this.size = 1;
    }
  }
}

// What an init hook is shown: an ordinary object.
function newTickObject(callback: unknown, args: unknown, frame: unknown): Record<string, unknown> {
  return { callback, args, frame };
}

function callWithArgumentsOfAnyKind(callback, args) {
  switch (args.length) {
    case 1:
      return callback(args[0]);
    case 2:
      return callback(args[0], args[1]);
    case 3:
      return callback(args[0], args[1], args[2]);
    case 4:
      return callback(args[0], args[1], args[2], args[3]);
    default:
      return callback(...args);
  }
}

function initializeNextTickQueue(process: typeof globalThis.process, nextTickQueue, drainMicrotasksFn) {
  var queue!: TickQueue;
  var tickInitHooks!: unknown[];
  var process: typeof globalThis.process;
  var nextTickQueue = nextTickQueue;
  var drainMicrotasks = drainMicrotasksFn;

  const { validateFunction } = require("internal/validators");

  var setup;
  setup = () => {
    queue = new TickQueue();
    tickInitHooks = require("internal/async_hooks_tick").tickInitHooks;

    function processTicksAndRejections() {
      let ran = 0;
      do {
        for (;;) {
          const tick = queue.read;
          if (tick === queue.write) break;
          const callback: any = tick.callback;
          const args = tick.args;
          const frame = tick.frame;
          tick.callback = undefined;
          tick.args = undefined;
          tick.frame = undefined;
          queue.read = tick.next;
          ran = (ran + 1) | 0;
          var restore = $getInternalField($asyncContext, 0);
          $putInternalField($asyncContext, 0, frame as any);
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
      } while (queue.read !== queue.write);
      queue.shrink(ran);
      // Without this, every checkpoint after the first tick calls this function to find an empty queue.
      $putInternalField(nextTickQueue, 0, 0);
    }

    $putInternalField(nextTickQueue, 0, 0);
    $putInternalField(nextTickQueue, 2, processTicksAndRejections);
    setup = undefined;
  };

  // node fires one TickObject init per process.nextTick() call, at
  // construction time (before the callback runs).
  function pushWithInitHooks(cb: unknown, args: unknown[] | undefined, frame: unknown): void {
    const tock = newTickObject(cb, args, frame);
    const asyncHooksTick = require("internal/async_hooks_tick");
    const asyncId = asyncHooksTick.newAsyncId();
    // Snapshot: enable()/disable() from inside a hook must not affect the
    // in-flight dispatch (node stages such mutations in tmp_array until
    // the emit completes).
    const hooks: any[] = tickInitHooks.slice();
    for (let i = 0; i < hooks.length; i++) {
      try {
        hooks[i](asyncId, "TickObject", 0, tock);
      } catch (err) {
        // node: a throwing init hook is fatal (fatalError: print + exit 1),
        // never surfaced to the process.nextTick() caller. console is a
        // user-mutable global, so shield the print; exit regardless.
        try {
          console.error(
            typeof (err as any)?.stack === "string" ? (err as Error).stack : err,
          );
        } catch {}
        process.exit(1);
      }
    }
    // A hook may have stored to the object it was shown, and may have done anything to the list in it.
    const list = tock.args;
    if (list === undefined) queue.push(tock.callback, undefined, tock.frame);
    else queue.push(callWithArgumentsOfAnyKind, [tock.callback, list], tock.frame);
  }

  function nextTick(cb: unknown, ...args: unknown[]) {
    validateFunction(cb, "callback");
    if (setup !== undefined) {
      setup();
      process = globalThis.process;
    }
    if (process._exiting) return;

    // We want to avoid materializing the args if there are none because it's
    // a waste of memory and Array.prototype.slice shows up in profiling.
    const list = args.length !== 0 ? args : undefined;
    const frame: unknown = $getInternalField($asyncContext, 0);
    if (tickInitHooks.length !== 0) pushWithInitHooks(cb, list, frame);
    else queue.push(cb, list, frame);
    $putInternalField(nextTickQueue, 0, 1);
  }

  return nextTick;
}

export default initializeNextTickQueue;
