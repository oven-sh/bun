// @ts-check
// The ticks that wait are in a ring of nodes, from `read` up to `write`, which is always free.
// The ring grows by a node when it is full, so nothing is allocated for a tick unless more are
// waiting than ever before. A ring that a burst has made larger than kMaxSize is dropped when a
// drain has used less than a quarter of it.
const kMaxSize = 1024;

class Tick {
  callback: unknown;
  count: number;
  first: unknown;
  second: unknown;
  third: unknown;
  args: unknown[] | undefined;
  frame: unknown;
  next: Tick;

  constructor() {
    this.callback = undefined;
    this.count = 0;
    this.first = undefined;
    this.second = undefined;
    this.third = undefined;
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

  claim(): Tick {
    const tick = this.write;
    let next = tick.next;
    if (next === this.read) next = this.grow(tick);
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

function callWithAnyArguments(callback, args) {
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

const { validateFunction } = require("internal/validators");

let process: any = undefined;
let nextTickQueue: any = undefined;
let drainMicrotasks: any = undefined;
let isStarted = false;
let queue: TickQueue = new TickQueue();
let tickInitHooks: unknown[] = [];

function setUp(processObject, nextTickQueueObject, drainMicrotasksFunction) {
  nextTickQueue = nextTickQueueObject;
  drainMicrotasks = drainMicrotasksFunction;
}

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
      if (count === 1) {
        const first = tick.first;
        tick.first = undefined;
        callback(first);
      } else if (count === 2) {
        const first = tick.first;
        const second = tick.second;
        tick.first = tick.second = undefined;
        callback(first, second);
      } else if (count === 3) {
        const first = tick.first;
        const second = tick.second;
        const third = tick.third;
        tick.first = tick.second = tick.third = undefined;
        callback(first, second, third);
      } else if (count === 0) {
        callback();
      } else {
        const args = tick.args!;
        tick.args = undefined;
        if (args.length === 4) callback(args[0], args[1], args[2], args[3]);
        else callback(...args);
      }
      $putInternalField($asyncContext, 0, restore);
    }

    drainMicrotasks();
  } while (queue.read !== queue.write);
  queue.shrink(ran);
  $putInternalField(nextTickQueue, 0, 0);
}

function start() {
  isStarted = true;
  process = globalThis.process;
  tickInitHooks = require("internal/async_hooks_tick").tickInitHooks;
  $putInternalField(nextTickQueue, 0, 0);
  $putInternalField(nextTickQueue, 2, processTicksAndRejections);
}

function push(callback: unknown, args: unknown[] | undefined, frame: unknown): void {
  const tick = queue.claim();
  tick.callback = callback;
  tick.frame = frame;
  if (args === undefined) {
    tick.count = 0;
    return;
  }
  const count = args.length;
  if (count > 3) {
    tick.count = 4;
    tick.args = args;
    return;
  }
  tick.count = count;
  tick.first = args[0];
  if (count > 1) tick.second = args[1];
  if (count > 2) tick.third = args[2];
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
      process.exit(1);
    }
  }
  const list = tock.args;
  if (list === undefined) push(tock.callback, undefined, tock.frame);
  else push(callWithAnyArguments, [tock.callback, list], tock.frame);
}

function nextTick(cb: unknown, ...args: unknown[]) {
  if (typeof cb !== "function") validateFunction(cb, "callback");
  if (!isStarted) start();
  if (process._exiting) return;

  const list = args.length !== 0 ? args : undefined;
  const frame: unknown = $getInternalField($asyncContext, 0);
  if (tickInitHooks.length !== 0) pushWithInitHooks(cb, list, frame);
  else push(cb, list, frame);
  $putInternalField(nextTickQueue, 0, 1);
}

let uncachedProcessChecks = 0;
function checkProcess(): boolean {
  if (nextTickQueue === undefined && (globalThis.process.nextTick === undefined || nextTickQueue === undefined))
    return false;
  if (!isStarted) start();
  if (process.nextTick !== nextTick || process._exiting) return false;
  if (IS_BUN_AOT && uncachedProcessChecks < 100) {
    const hasExiting = Object.prototype.hasOwnProperty.$call(process, "_exiting");
    if (!(
      $watchProperty(process, "nextTick") &&
      (!hasExiting || $watchProperty(process, "_exiting")) &&
      $setCheckedStructure(process, 12)
    ))
      uncachedProcessChecks++;
  }
  return true;
}
function mayQueueDirectly(): boolean {
  return ((IS_BUN_AOT && $isCheckedStructure(process, 12)) || checkProcess()) && tickInitHooks.length === 0;
}

function capturedTick1(captured: any, callback: unknown, first: unknown): void {
  if (captured !== nextTick || !mayQueueDirectly()) return void captured(callback, first);
  const tick = queue.claim();
  tick.callback = callback;
  tick.frame = $getInternalField($asyncContext, 0);
  tick.count = 1;
  tick.first = first;
  $putInternalField(nextTickQueue, 0, 1);
}
function tick1(callback: unknown, first: unknown): void {
  if (!mayQueueDirectly()) return void globalThis.process.nextTick(callback, first);
  const tick = queue.claim();
  tick.callback = callback;
  tick.frame = $getInternalField($asyncContext, 0);
  tick.count = 1;
  tick.first = first;
  $putInternalField(nextTickQueue, 0, 1);
}
function tick2(callback: unknown, first: unknown, second: unknown): void {
  if (!mayQueueDirectly()) return void globalThis.process.nextTick(callback, first, second);
  const tick = queue.claim();
  tick.callback = callback;
  tick.frame = $getInternalField($asyncContext, 0);
  tick.count = 2;
  tick.first = first;
  tick.second = second;
  $putInternalField(nextTickQueue, 0, 1);
}
function tick3(callback: unknown, first: unknown, second: unknown, third: unknown): void {
  if (!mayQueueDirectly()) return void globalThis.process.nextTick(callback, first, second, third);
  const tick = queue.claim();
  tick.callback = callback;
  tick.frame = $getInternalField($asyncContext, 0);
  tick.count = 3;
  tick.first = first;
  tick.second = second;
  tick.third = third;
  $putInternalField(nextTickQueue, 0, 1);
}

export default { setUp, nextTick, capturedTick1, tick1, tick2, tick3 };
