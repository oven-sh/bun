// @ts-check
// The ticks that wait are in a ring of nodes, from `read` up to `write`, which is always free.
// The ring grows by a node when it is full, so nothing is allocated for a tick unless more are
// waiting than ever before. A ring that a burst has made larger than kMaxSize is dropped when a
// drain has used less than a quarter of it.
// Up to four arguments of a tick lie in its node. More than four lie in an array in `first`.
const kMaxSize = 1024;

class Tick {
  callback: unknown;
  count: number;
  first: unknown;
  second: unknown;
  third: unknown;
  fourth: unknown;
  frame: unknown;
  next: Tick;

  constructor() {
    this.callback = undefined;
    this.count = 0;
    this.first = undefined;
    this.second = undefined;
    this.third = undefined;
    this.fourth = undefined;
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

  take(callback: unknown, frame: unknown): Tick {
    const tick = this.write;
    let next = tick.next;
    if (next === this.read) next = this.grow(tick);
    tick.callback = callback;
    tick.frame = frame;
    this.write = next;
    return tick;
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

function newTickObject(callback: unknown, args: unknown, frame: unknown): Record<string, unknown> {
  return { callback, args, frame };
}

function listOf(...list: unknown[]): unknown[] {
  return list;
}

function callWithAnyArguments(callback: any, args: any): unknown {
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

const queue = new TickQueue();
let installedNextTick: unknown = queue;
let tickInitHooks!: unknown[];
let tickingProcess!: typeof globalThis.process;
let nextTickQueue: any;
let drainMicrotasks!: () => void;
let validateFunction!: (value: unknown, name: string) => void;
let isSetUp = false;

function processTicksAndRejections() {
  let ran = 0;
  do {
    for (;;) {
      const tick = queue.read;
      if (tick === queue.write) break;
      const callback: any = tick.callback;
      const count = tick.count;
      const frame = tick.frame;
      tick.callback = undefined;
      tick.frame = undefined;
      queue.read = tick.next;
      ran = (ran + 1) | 0;
      var restore = $getInternalField($asyncContext, 0);
      $putInternalField($asyncContext, 0, frame as any);
      if (count === 0) {
        callback();
      } else {
        const first = tick.first;
        tick.first = undefined;
        if (count === 1) {
          callback(first);
        } else if (count > 4) {
          callback(...(first as unknown[]));
        } else {
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
      }
      $putInternalField($asyncContext, 0, restore);
    }

    drainMicrotasks();
  } while (queue.read !== queue.write);
  queue.shrink(ran);
  $putInternalField(nextTickQueue, 0, 0);
}

function setUp(): void {
  tickInitHooks = require("internal/async_hooks_tick").tickInitHooks;
  $putInternalField(nextTickQueue, 0, 0);
  $putInternalField(nextTickQueue, 2, processTicksAndRejections);
  isSetUp = true;
  tickingProcess = globalThis.process;
}

function pushWithInitHooks(cb: unknown, args: unknown[] | undefined, frame: unknown): void {
  const tock = newTickObject(cb, args, frame);
  const asyncHooksTick = require("internal/async_hooks_tick");
  const asyncId = asyncHooksTick.newAsyncId();
  const hooks: any[] = tickInitHooks.slice();
  for (let i = 0; i < hooks.length; i++) {
    try {
      hooks[i](asyncId, "TickObject", 0, tock);
    } catch (err) {
      try {
        console.error(typeof (err as any)?.stack === "string" ? (err as Error).stack : err);
      } catch {}
      tickingProcess.exit(1);
    }
  }
  const list = tock.args;
  if (list === undefined) {
    queue.take(tock.callback, tock.frame).count = 0;
  } else {
    const tick = queue.take(callWithAnyArguments, tock.frame);
    tick.first = tock.callback;
    tick.second = list;
    tick.count = 2;
  }
}

function nextTick(cb: unknown, ...args: unknown[]) {
  if (typeof cb !== "function") validateFunction(cb, "callback");
  if (!isSetUp) setUp();
  if (tickingProcess._exiting) return;

  const count = args.length | 0;
  const frame: unknown = $getInternalField($asyncContext, 0);
  if (tickInitHooks.length !== 0) {
    pushWithInitHooks(cb, count !== 0 ? listOf(...args) : undefined, frame);
  } else {
    const tick = queue.take(cb, frame);
    tick.count = count;
    if (count !== 0) {
      if (count > 4) {
        tick.first = listOf(...args);
      } else {
        tick.first = args[0];
        if (count !== 1) {
          tick.second = args[1];
          if (count !== 2) {
            tick.third = args[2];
            if (count !== 3) tick.fourth = args[3];
          }
        }
      }
    }
  }
  $putInternalField(nextTickQueue, 0, 1);
}

// What nextTick(callback, first) does, for a caller that holds nextTick itself and a callback that is a function.
function enqueueTick1(callback: unknown, first: unknown): void {
  if (!isSetUp) setUp();
  if (tickingProcess._exiting) return;
  const frame: unknown = $getInternalField($asyncContext, 0);
  if (tickInitHooks.length !== 0) {
    pushWithInitHooks(callback, [first], frame);
  } else {
    const tick = queue.take(callback, frame);
    tick.count = 1;
    tick.first = first;
  }
  $putInternalField(nextTickQueue, 0, 1);
}

function enqueueTick2(callback: unknown, first: unknown, second: unknown): void {
  if (!isSetUp) setUp();
  if (tickingProcess._exiting) return;
  const frame: unknown = $getInternalField($asyncContext, 0);
  if (tickInitHooks.length !== 0) {
    pushWithInitHooks(callback, [first, second], frame);
  } else {
    const tick = queue.take(callback, frame);
    tick.count = 2;
    tick.first = first;
    tick.second = second;
  }
  $putInternalField(nextTickQueue, 0, 1);
}

function enqueueTick3(callback: unknown, first: unknown, second: unknown, third: unknown): void {
  if (!isSetUp) setUp();
  if (tickingProcess._exiting) return;
  const frame: unknown = $getInternalField($asyncContext, 0);
  if (tickInitHooks.length !== 0) {
    pushWithInitHooks(callback, [first, second, third], frame);
  } else {
    const tick = queue.take(callback, frame);
    tick.count = 3;
    tick.first = first;
    tick.second = second;
    tick.third = third;
  }
  $putInternalField(nextTickQueue, 0, 1);
}

// target.nextTick(callback, first) as a built-in module writes it, with `process` for the target: the property is read at every call, so a program that replaces it is obeyed.
function queueTick1(target: any, callback: unknown, first: unknown): void {
  const current = target.nextTick;
  if (current === installedNextTick) enqueueTick1(callback, first);
  else current.$call(target, callback, first);
}

function queueTick2(target: any, callback: unknown, first: unknown, second: unknown): void {
  const current = target.nextTick;
  if (current === installedNextTick) enqueueTick2(callback, first, second);
  else current.$call(target, callback, first, second);
}

function queueTick3(target: any, callback: unknown, first: unknown, second: unknown, third: unknown): void {
  const current = target.nextTick;
  if (current === installedNextTick) enqueueTick3(callback, first, second, third);
  else current.$call(target, callback, first, second, third);
}

function initializeNextTickQueue(_process: typeof globalThis.process, marker: unknown, drainMicrotasksFn: () => void) {
  nextTickQueue = marker;
  drainMicrotasks = drainMicrotasksFn;
  validateFunction = require("internal/validators").validateFunction;
  installedNextTick = nextTick;
  return nextTick;
}

export default { initializeNextTickQueue, nextTick, enqueueTick1, queueTick1, queueTick2, queueTick3 };
