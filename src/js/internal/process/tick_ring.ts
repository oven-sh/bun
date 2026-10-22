// The ticks that wait are in a ring of nodes, from `ring.read` up to `ring.write`, which is always free.
// The ring grows by a node when it is full, so nothing is allocated for a tick unless more are
// waiting than ever before. A ring that a burst has made larger than kMaxSize is dropped when a
// drain has used less than a quarter of it.
// Up to four arguments of a tick lie in its node. More than four lie in an array in `list`.
// A tick whose TickObject an `init` hook of node:async_hooks has seen holds that object in `shown`: the program may change it until the tick runs.
const { ring, takeTick } = require("internal/process/next_tick_queue");
const asyncHooksTick = require("internal/async_hooks_tick");

const tickInitHooks = asyncHooksTick.tickInitHooks;
// The realm has one for good. A constant of the module is read without a look at the global object.
const asyncContext = $asyncContext;
const kMaxSize = 1024;
const kHasTickObject = -1;

/** Any function: a program hands its own to process.nextTick. A type with a signature holds only the functions that code the compiler sees converts to it. */
type TickCallback = Function;
/** The async context a tick was queued in. */
type Frame = import("../../node/async_hooks").Frame | undefined;

/** What an `init` hook of node:async_hooks is shown. The program may change it until the tick runs. */
interface TickObject {
  callback: TickCallback;
  args: unknown[] | undefined;
  frame: Frame;
}

class Tick {
  callback: TickCallback | undefined;
  count: number;
  first: unknown;
  second: unknown;
  third: unknown;
  fourth: unknown;
  list: unknown[] | undefined;
  shown: TickObject | undefined;
  frame: Frame;
  next: Tick;

  constructor() {
    this.callback = undefined;
    this.count = 0;
    this.first = undefined;
    this.second = undefined;
    this.third = undefined;
    this.fourth = undefined;
    this.list = undefined;
    this.shown = undefined;
    this.frame = undefined;
    this.next = this;
  }
}

/** It belongs to internal/process/next_tick_queue, where it is a constant of the functions that add a tick. Empty until the first tick. */
interface Ring {
  read: Tick | undefined;
  write: Tick | undefined;
  size: number;
  /** What queues a tick while an `init` hook is enabled. node:async_hooks puts it here with the first hook. */
  pushWithInitHooks: typeof pushWithInitHooks | undefined;
}

function newRing(): void {
  ring.read = ring.write = new Tick();
  ring.size = 1;
}

function growRing(after: Tick): Tick {
  const tick = new Tick();
  tick.next = after.next;
  after.next = tick;
  ring.size++;
  return tick;
}

function newTickObject(callback: TickCallback, args: unknown[] | undefined, frame: Frame): TickObject {
  return { callback, args, frame };
}

let tickingProcess!: NodeJS.Process;
let nextTickQueue: any;
let drainMicrotasks!: () => void;

function processTicksAndRejections() {
  const context = asyncContext;
  let ran = 0;
  do {
    for (;;) {
      const tick = ring.read!;
      if (tick === ring.write) break;
      const callback = tick.callback!;
      const count = tick.count;
      const frame = tick.frame;
      tick.callback = undefined;
      tick.frame = undefined;
      ring.read = tick.next;
      ran = (ran + 1) | 0;
      var restore = $getInternalField(context, 0);
      $putInternalField(context, 0, frame);
      if (count === 0) {
        callback();
      } else if (count === 1) {
        const first = tick.first;
        tick.first = undefined;
        callback(first);
      } else if (count > 4) {
        "unlikely";
        const list = tick.list!;
        tick.list = undefined;
        callback(...list);
      } else if (count === kHasTickObject) {
        // The TickObject is read in the async context that is current between ticks.
        $putInternalField(context, 0, restore);
        const tock = tick.shown!;
        tick.shown = undefined;
        const callback = tock.callback;
        const args = tock.args;
        const frame = tock.frame;
        restore = $getInternalField(context, 0);
        $putInternalField(context, 0, frame);
        if (args === undefined) callback();
        else callback(...args);
      } else {
        const first = tick.first;
        tick.first = undefined;
        const second = tick.second;
        tick.second = undefined;
        if (count === 2) {
          callback(first, second);
        } else {
          const third = tick.third;
          tick.third = undefined;
          if (count === 3) {
            callback(first, second, third);
          } else {
            const fourth = tick.fourth;
            tick.fourth = undefined;
            callback(first, second, third, fourth);
          }
        }
      }
      $putInternalField(context, 0, restore);
    }

    drainMicrotasks();
  } while (ring.read !== ring.write);
  if (ring.size > kMaxSize && ran * 4 < ring.size) {
    "unlikely";
    newRing();
  }
  $putInternalField(nextTickQueue, 0, 0);
}

function pushWithInitHooks(cb: TickCallback, args: unknown[] | undefined, frame: Frame): void {
  const tock = newTickObject(cb, args, frame);
  const asyncId = asyncHooksTick.newAsyncId();
  const count = tickInitHooks.length;
  const hooks = $newArrayWithSize<(typeof tickInitHooks)[number]>(count);
  for (let i = 0; i < count; i++) $putByValDirect(hooks, i, tickInitHooks[i]);
  for (let i = 0; i < count; i++) {
    if (hooks[i](asyncId, "TickObject", 0, tock)) tickingProcess.exit(1);
  }
  const tick = takeTick(undefined, undefined);
  tick.shown = tock;
  tick.count = kHasTickObject;
}

function start(process: NodeJS.Process, marker: unknown, drainMicrotasksFn: () => void) {
  newRing();
  tickingProcess = process;
  nextTickQueue = marker;
  drainMicrotasks = drainMicrotasksFn;
  return processTicksAndRejections;
}

export type { Frame, Ring, Tick, TickCallback };

export default { growRing, tickInitHooks, pushWithInitHooks, start };
