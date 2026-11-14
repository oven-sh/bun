// The ticks that wait are in a ring of nodes, from `ring.read` up to `ring.write`, which is always free.
const { ring, takeTick, asyncContext } = require("internal/process/next_tick_queue");
const asyncHooksTick = require("internal/async_hooks_tick");

const tickInitHooks = asyncHooksTick.tickInitHooks;
const kFreeTicksKept = 4096;
const kHasTickObject = -1;

/** Any function: a program hands its own to process.nextTick. A type with a signature holds only the functions that code the compiler sees converts to it. */
type TickCallback = Function;
/** The async context a tick was queued in. */
type Frame = import("../../node/async_hooks").Frame | undefined;

/** What an `init` hook of node:async_hooks is shown. The program may change it until the tick runs. A tick with over three arguments has one too. */
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
  shown: TickObject | undefined;
  frame: Frame;
  next: Tick;

  constructor() {
    this.callback = undefined;
    this.count = 0;
    this.first = undefined;
    this.second = undefined;
    this.third = undefined;
    this.shown = undefined;
    this.frame = undefined;
    this.next = this;
  }
}

/** It belongs to internal/process/next_tick_queue, where it is a constant of the functions that add a tick. Empty until the first tick. */
interface Ring {
  read: Tick | undefined;
  write: Tick | undefined;
  /** By how many nodes the ring is larger than it stays once no tick waits. */
  spare: number;
  /** Whether the tick that drops the free nodes waits. */
  willDropFreeTicks: boolean;
  /** A node of the ring. queueTickInFront moves it on to the node in front of `read`. */
  beforeRead: Tick | undefined;
  /** What queues a tick while an `init` hook is enabled. node:async_hooks puts it here with the first hook. */
  pushWithInitHooks: typeof pushWithInitHooks | undefined;
}

function growRing(after: Tick): Tick {
  const tick = new Tick();
  tick.next = after.next;
  after.next = tick;
  const spare = (ring.spare + 1) | 0;
  ring.spare = spare;
  if (spare > 0 && !ring.willDropFreeTicks) {
    ("unlikely");
    ring.willDropFreeTicks = true;
    ring.spare = (spare + 1) | 0;
    tick.callback = dropFreeTicks;
    const write = new Tick();
    write.next = tick.next;
    tick.next = write;
    return write;
  }
  return tick;
}

// Runs as a tick of the ring's own. It drops the free nodes over kFreeTicksKept. Where kFreeTicksKept ticks or more wait it comes again behind the first kFreeTicksKept of them:
// the ticks of a burst are let go as they run, and each walk over nodes is paid for by as many ticks. Where fewer wait it is the last: their nodes stay until the ring next grows.
// What still refers to a dropped node holds no node that is dropped later.
function dropFreeTicks(): void {
  const read = ring.read!;
  const write = ring.write!;
  let before = read;
  let manyWait = read !== write;
  for (let passed = 1; manyWait && passed < kFreeTicksKept; passed++) {
    before = before.next;
    manyWait = before !== write;
  }
  let ahead = write.next;
  let kept = 0;
  while (kept < kFreeTicksKept && ahead !== read) {
    ahead = ahead.next;
    kept++;
  }
  if (ahead !== read) {
    let last = write;
    let dropped = 0;
    while (ahead !== read) {
      ahead = ahead.next;
      last = last.next;
      dropped++;
    }
    const firstKept = last.next;
    last.next = last;
    write.next = firstKept;
    ring.spare = (ring.spare - dropped) | 0;
    ring.beforeRead = write;
  }
  if (!manyWait) {
    ring.willDropFreeTicks = false;
    return;
  }
  let free = write.next;
  if (free === read) {
    free = new Tick();
    ring.spare = (ring.spare + 1) | 0;
  } else {
    write.next = free.next;
    ring.beforeRead = write;
  }
  free.next = before.next;
  before.next = free;
  free.callback = dropFreeTicks;
  free.frame = undefined;
  free.count = 0;
}

// Queues a tick with one or two arguments ahead of the ticks that wait, in the async context that is current.
function queueTickInFront(callback: TickCallback, count: number, first: unknown, second: unknown): void {
  const read = ring.read!;
  const write = ring.write!;
  // A step for each tick that was queued or has run since the last time.
  let before = ring.beforeRead!;
  while (before.next !== read) before = before.next;
  let free = write.next;
  const grows = free === read;
  if (grows) {
    free = new Tick();
    ring.spare = (ring.spare + 1) | 0;
    write.next = free;
    free.next = read;
  } else if (free === before) {
    before = write;
  } else {
    write.next = free.next;
    before.next = free;
    free.next = read;
  }
  ring.beforeRead = before;
  free.callback = callback;
  free.frame = $getInternalField(asyncContext, 0);
  free.count = count;
  free.first = first;
  free.second = second;
  ring.read = free;
  $putInternalField(nextTickQueue, 0, 1);
  if (grows && ring.spare > 0 && !ring.willDropFreeTicks) {
    ring.willDropFreeTicks = true;
    takeTick(dropFreeTicks, undefined).count = 0;
  }
}

function newTickObject(callback: TickCallback, args: unknown[] | undefined, frame: Frame): TickObject {
  return { callback, args, frame };
}

let tickingProcess!: NodeJS.Process;
let nextTickQueue: any;

function takeTickObject(tick: Tick): TickObject {
  const tock = tick.shown!;
  tick.shown = undefined;
  return tock;
}

function pushTickObject(tock: TickObject): void {
  const tick = takeTick(undefined, undefined);
  tick.shown = tock;
  tick.count = kHasTickObject;
}

function pushWithList(cb: TickCallback, args: unknown[], frame: Frame): void {
  pushTickObject(newTickObject(cb, args, frame));
}

function pushWithInitHooks(cb: TickCallback, args: unknown[] | undefined, frame: Frame): void {
  const tock = newTickObject(cb, args, frame);
  const asyncId = asyncHooksTick.newAsyncId();
  const count = tickInitHooks.length;
  const hooks = $newArrayWithSize<(typeof tickInitHooks)[number]>(count);
  for (let i = 0; i < count; i++) $putByValDirect(hooks, i, tickInitHooks[i]);
  for (let i = 0; i < count; i++) {
    try {
      hooks[i](asyncId, "TickObject", 0, tock);
    } catch (err: any) {
      try {
        console.error(typeof err?.stack === "string" ? err.stack : err);
      } catch {}
      tickingProcess.exit(1);
    }
  }
  pushTickObject(tock);
}

function start(process: NodeJS.Process, marker: any, processTicksAndRejections: () => void): void {
  ring.read = ring.write = ring.beforeRead = new Tick();
  ring.spare = -kFreeTicksKept;
  tickingProcess = process;
  nextTickQueue = marker;
  $putInternalField(marker, 2, processTicksAndRejections);
}

// pushWithInitHooks() as a part of process.nextTick: without ahead-of-time compilation nextTick calls the hooks itself, so a hook finds nextTick below it.
function pushInsideNextTick(cb: TickCallback, args: unknown[] | undefined, frame: Frame): void {
  ("has no frames");
  const tock = newTickObject(cb, args, frame);
  const asyncId = asyncHooksTick.newAsyncId();
  const count = tickInitHooks.length;
  const hooks = $newArrayWithSize<(typeof tickInitHooks)[number]>(count);
  for (let i = 0; i < count; i++) $putByValDirect(hooks, i, tickInitHooks[i]);
  for (let i = 0; i < count; i++) {
    try {
      hooks[i](asyncId, "TickObject", 0, tock);
    } catch (err: any) {
      try {
        console.error(typeof err?.stack === "string" ? err.stack : err);
      } catch {}
      tickingProcess.exit(1);
    }
  }
  pushTickObject(tock);
}

export type { Frame, Ring, Tick, TickCallback };

export default {
  growRing,
  tickInitHooks,
  pushWithList,
  pushWithInitHooks,
  pushInsideNextTick,
  pushTickObject,
  takeTickObject,
  queueTickInFront,
  start,
};
