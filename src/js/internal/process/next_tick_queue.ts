// process.nextTick, and what a built-in module calls in its place.
type TickRing = $BunModules["internal/process/tick_ring"];
type Tick = import("./tick_ring").Tick;
type TickCallback = import("./tick_ring").TickCallback;
type Frame = import("./tick_ring").Frame;

function listOf(...list: unknown[]): unknown[] {
  return list;
}

const ring: import("./tick_ring").Ring = { read: undefined, write: undefined, made: 0, pushWithInitHooks: undefined };
let growRing!: TickRing["growRing"];
let pushWithList!: TickRing["pushWithList"];
let tickInitHooks!: TickRing["tickInitHooks"];
let installedNextTick: unknown = {};
let tickingProcess!: NodeJS.Process;
let nextTickQueue: any;
let drainMicrotasks!: () => void;
let isSetUp = false;
// The realm has one for good. A constant of the module is read without a look at the global object.
const asyncContext = $asyncContext;

function setUp(): void {
  const tickRing = require("internal/process/tick_ring");
  growRing = tickRing.growRing;
  pushWithList = tickRing.pushWithList;
  tickInitHooks = tickRing.tickInitHooks;
  $putInternalField(nextTickQueue, 0, 0);
  $putInternalField(nextTickQueue, 2, tickRing.start(tickingProcess, nextTickQueue, drainMicrotasks));
  isSetUp = true;
}

function takeTick(callback: TickCallback | undefined, frame: Frame): Tick {
  const tick = ring.write!;
  let next = tick.next;
  if (next === ring.read) {
    ("unlikely");
    next = growRing(tick);
  }
  tick.callback = callback;
  tick.frame = frame;
  ring.write = next;
  return tick;
}

function nextTick(cb: TickCallback, ...args: unknown[]) {
  if (typeof cb !== "function") throw $ERR_INVALID_ARG_TYPE("callback", "function", cb);
  if (!isSetUp) setUp();
  if (tickingProcess._exiting) return;

  const count = args.length | 0;
  const frame: Frame = $getInternalField(asyncContext, 0);
  if (tickInitHooks.length !== 0) {
    ("unlikely");
    ring.pushWithInitHooks!(cb, count !== 0 ? listOf(...args) : undefined, frame);
  } else if (count > 3) {
    ("unlikely");
    pushWithList(cb, listOf(...args), frame);
  } else {
    const tick = takeTick(cb, frame);
    tick.count = count;
    if (count !== 0) {
      tick.first = args[0];
      if (count !== 1) {
        tick.second = args[1];
        if (count !== 2) tick.third = args[2];
      }
    }
  }
  $putInternalField(nextTickQueue, 0, 1);
}

// What nextTick does with `count` arguments, one to three, for a caller that holds nextTick itself and a callback that is a function.
function enqueueTick(callback: TickCallback, count: number, first: unknown, second: unknown, third: unknown): void {
  if (!isSetUp) setUp();
  if (tickingProcess._exiting) return;
  const frame: Frame = $getInternalField(asyncContext, 0);
  if (tickInitHooks.length !== 0) {
    ("unlikely");
    ring.pushWithInitHooks!(
      callback,
      count === 1 ? [first] : count === 2 ? [first, second] : [first, second, third],
      frame,
    );
  } else {
    // takeTick(), written out: this is what the built-in modules queue every tick of a request with.
    const tick = ring.write!;
    let next = tick.next;
    if (next === ring.read) {
      ("unlikely");
      next = growRing(tick);
    }
    tick.callback = callback;
    tick.frame = frame;
    ring.write = next;
    tick.count = count | 0;
    tick.first = first;
    tick.second = second;
    tick.third = third;
  }
  $putInternalField(nextTickQueue, 0, 1);
}

function ticksAreUnseen(): boolean {
  return isSetUp && process.nextTick === installedNextTick && tickInitHooks.length === 0;
}

function ticksAreUnhooked(): boolean {
  return isSetUp && tickInitHooks.length === 0;
}

function enqueueTick1(callback: TickCallback, first: unknown): void {
  enqueueTick(callback, 1, first, undefined, undefined);
}

function queueTick1(callback: TickCallback, first: unknown): void {
  const target = process;
  const current = target.nextTick;
  if (current === installedNextTick) enqueueTick(callback, 1, first, undefined, undefined);
  else {
    ("unlikely");
    current.$call(target, callback, first);
  }
}

function queueTick2(callback: TickCallback, first: unknown, second: unknown): void {
  const target = process;
  const current = target.nextTick;
  if (current === installedNextTick) enqueueTick(callback, 2, first, second, undefined);
  else {
    ("unlikely");
    current.$call(target, callback, first, second);
  }
}

function queueTick3(callback: TickCallback, first: unknown, second: unknown, third: unknown): void {
  const target = process;
  const current = target.nextTick;
  if (current === installedNextTick) enqueueTick(callback, 3, first, second, third);
  else {
    ("unlikely");
    current.$call(target, callback, first, second, third);
  }
}

function initializeNextTickQueue(process: NodeJS.Process, marker: unknown, drainMicrotasksFn: () => void) {
  tickingProcess = process;
  nextTickQueue = marker;
  drainMicrotasks = drainMicrotasksFn;
  installedNextTick = nextTick;
  return nextTick;
}

export default {
  initializeNextTickQueue,
  nextTick,
  ticksAreUnseen,
  ticksAreUnhooked,
  enqueueTick1,
  queueTick1,
  queueTick2,
  queueTick3,
  ring,
  takeTick,
};
