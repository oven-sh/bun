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
  /** The nodes made since a tick that drops the free ones was last queued. */
  made: number;
  /** What queues a tick while an `init` hook is enabled. node:async_hooks puts it here with the first hook. */
  pushWithInitHooks: typeof pushWithInitHooks | undefined;
}

function growRing(after: Tick): Tick {
  const tick = new Tick();
  tick.next = after.next;
  after.next = tick;
  const made = (ring.made + 1) | 0;
  ring.made = made;
  if (made === kFreeTicksKept) {
    ("unlikely");
    ring.made = 0;
    tick.callback = dropFreeTicks;
    const write = new Tick();
    write.next = tick.next;
    tick.next = write;
    return write;
  }
  return tick;
}

// Runs as a tick of the ring's own. What still refers to a dropped node holds no node that is dropped later.
function dropFreeTicks(): void {
  const read = ring.read!;
  const write = ring.write!;
  let ahead = write.next;
  for (let kept = 0; kept < kFreeTicksKept; kept++) {
    if (ahead === read) return;
    ahead = ahead.next;
  }
  let last = write;
  while (ahead !== read) {
    ahead = ahead.next;
    last = last.next;
  }
  const firstKept = last.next;
  last.next = last;
  write.next = firstKept;
}

// Queues a tick with one or two arguments ahead of the ticks that wait, in the async context that is current.
function queueTickInFront(callback: TickCallback, count: number, first: unknown, second: unknown): void {
  const read = ring.read!;
  let free = ring.write!;
  if (free.next === read) {
    const tick = new Tick();
    tick.next = read;
    free.next = tick;
  }
  do free = free.next;
  while (free.next !== read);
  free.callback = callback;
  free.frame = $getInternalField(asyncContext, 0);
  free.count = count;
  free.first = first;
  free.second = second;
  ring.read = free;
  $putInternalField(nextTickQueue, 0, 1);
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
  asyncHooksTick.beginHookDispatch();
  try {
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
  } finally {
    asyncHooksTick.endHookDispatch();
  }
  pushTickObject(tock);
}

function start(process: NodeJS.Process, marker: any, processTicksAndRejections: () => void): void {
  ring.read = ring.write = new Tick();
  tickingProcess = process;
  nextTickQueue = marker;
  $putInternalField(marker, 2, processTicksAndRejections);
}

export type { Frame, Ring, Tick, TickCallback };

export default {
  growRing,
  tickInitHooks,
  pushWithList,
  pushWithInitHooks,
  pushTickObject,
  takeTickObject,
  queueTickInFront,
  start,
};
