// The tasks of the pages and of what hosts them, and the frames in between. One instance for each thread.
const drainMicrotasks = $bindgen("desktop.bind.ts", "drainMicrotasks");
/** Those go through the event loop, and are as urgent as visible tasks. */
const hasLocalMessages = $newCppFunction("DesktopRealm.cpp", "jsFunctionDesktopRealmHasLocalMessages", 0);

type Callback = (a?: any, b?: any, c?: any, d?: any) => void;

class Task {
  next: Task | null = null;
  /** A timer's index in the heap, or -1. */
  index: int32 = -1;
  time = 0;
  /** 0 unless it repeats. */
  interval = 0;
  order: number;
  run: Callback | null;
  a: unknown;
  b: unknown;
  c: unknown;
  d: unknown;

  constructor(run: Callback, a: unknown, b: unknown, c: unknown, d: unknown) {
    this.order = nextOrder++;
    this.run = run;
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
  }
}

class Queue {
  first: Task | null = null;
  last: Task | null = null;

  push(task: Task) {
    task.next = null;
    if (this.last === null) this.first = task;
    else this.last.next = task;
    this.last = task;
  }

  shift(): Task | null {
    const task = this.first;
    if (task === null) return null;
    if ((this.first = task.next) === null) this.last = null;
    task.next = null;
    return task;
  }
}

interface Canvas {
  /** Whether a script waits for the frame or has changed it, unlike an animation that only goes on. */
  isAwaited(): boolean;
  render(): void;
}

const BLOCKING = 0;
const VISIBLE = 1;
/** What would run in another process. */
const HOST = 2;
const BACKGROUND = 3;

const { display } = require("internal/desktop/native");
/** How long input waits for tasks. */
const BUSY_INTERVAL = 50;
const BUSY_INTERVAL_AT_LAUNCH = 200;
const LAUNCH_DURATION = 3000;
const SLICE = 4;
const HURRY_DURATION = 200;
const HURRIED_FRAMES = 10;
/** Timers that are longer than that fire together with others. */
const PRECISE_DELAY = 64;
const TIMER_ALIGNMENT = 8;

const blocking = new Queue();
const visible = new Queue();
const host = new Queue();
const background = new Queue();
const queues = [blocking, visible, host, background];
const timers: Task[] = [];
let stale: Canvas[] = [];

let nextOrder = 0;
let isPumpQueued = false;
const afterMicrotasks: (() => void)[] = [];
/** A script of a page is waiting, so only the host goes on. */
let isSuspended = false;
let busyInterval = BUSY_INTERVAL_AT_LAUNCH;
let scrollsUntil = 0;
let staleSince = 0;
let lastFrame = 0;
let hurryUntil = 0;
/** When the first task of the host since the last frame ran. */
let busySince = 0;
let hurriedFramesLeft: int32 = 0;
let alarm: ReturnType<typeof setTimeout> | undefined;
let alarmTime = Infinity;

function queuePump() {
  if (isPumpQueued) return;
  isPumpQueued = true;
  setImmediate(pump);
}

function post(priority: int32, run: Callback, a?: unknown, b?: unknown, c?: unknown, d?: unknown): Task {
  const task = new Task(run, a, b, c, d);
  queues[priority].push(task);
  queuePump();
  return task;
}

function isFrameDue(now: number): boolean {
  if (isSuspended) return false;
  if (isHostBusy(now)) return false;
  if (blocking.first !== null || visible.first !== null || hasLocalMessages()) {
    return now - staleSince >= display.frameInterval && now - lastFrame >= display.frameInterval;
  }
  if (now - lastFrame > display.frameInterval + 1) return true;
  if (hurriedFramesLeft === 0 || now > hurryUntil || !stale.some(isAwaited)) return false;
  hurriedFramesLeft--;
  return true;
}

const isAwaited = (canvas: Canvas) => canvas.isAwaited();

function render() {
  const canvases = stale;
  stale = [];
  for (let i = 0; i < canvases.length; i++) canvases[i].render();
}

const hasTasks = (queue: Queue) => queue.first !== null;

function setSuspended(value: boolean) {
  isSuspended = value;
  queuePump();
}

function nextTask(): Task | null {
  if (isSuspended) return host.shift();
  if (blocking.first !== null) return blocking.shift();
  if (host.first !== null && performance.now() > hurryUntil) {
    busySince ||= performance.now();
    return host.shift();
  }
  if (visible.first === null) {
    if (stale.length > 0 && hasLocalMessages()) return null;
    return host.shift() ?? (hasLocalMessages() ? null : background.shift());
  }
  if (host.first === null || stale.length > 0 || visible.first.order < host.first.order) return visible.shift();
  return host.shift();
}

function finishCheckpoint() {
  if (afterMicrotasks.length > 0) for (const run of afterMicrotasks.splice(0)) run();
}

function pump() {
  finishCheckpoint();
  const start = performance.now();
  let now = start;
  isPumpQueued = false;
  do {
    $putInternalField($asyncContext, 0, undefined);
    try {
      if (stale.length > 0 && isFrameDue(now)) render();
      else {
        const task = nextTask();
        if (task === null)
          return void ((stale.length > 0 || queues.some(hasTasks)) && hasLocalMessages() && queuePump());
        const { run } = task;
        if (run === null) continue;
        // A dialog runs the event loop inside of the task.
        if (!isPumpQueued && queues.some(hasTasks)) queuePump();
        run(task.a, task.b, task.c, task.d);
        if (task.interval !== 0 && task.run !== null) addTimer(task, task.interval);
      }
    } catch (error) {
      reportError(error);
    }
    drainMicrotasks();
    finishCheckpoint();
    const before = now;
    now = performance.now();
    if (now - before > BUSY_INTERVAL && busyInterval !== BUSY_INTERVAL && now < LAUNCH_DURATION) busySince = 0;
  } while (now - start < SLICE);
  queuePump();
}

function wantsFrame(canvas: Canvas) {
  if (stale.includes(canvas)) return;
  if (stale.length === 0) staleSince = performance.now();
  stale.push(canvas);
  queuePump();
}

/** The host is still answering what the page has asked for, so a frame would soon be out of date. */
function isHostBusy(now: number): boolean {
  if (now <= hurryUntil || now <= scrollsUntil) return false;
  if (host.first === null && (busySince === 0 || visible.first === null)) return false;
  return busySince === 0 || now - busySince < (now < LAUNCH_DURATION ? busyInterval : BUSY_INTERVAL);
}

function scrolls() {
  scrollsUntil = performance.now() + HURRY_DURATION;
}

const canFrameWait = (): boolean => isHostBusy(performance.now());

function beginsFrame(canvas: Canvas) {
  lastFrame = performance.now();
  busySince = 0;
  const index = stale.indexOf(canvas);
  if (index >= 0) stale.splice(index, 1);
}

/** For what the user has just done: the frames that follow from it do not wait for the display. */
function hurry(isInput = true) {
  if (isInput) busyInterval = BUSY_INTERVAL;
  else if (busyInterval !== BUSY_INTERVAL && performance.now() < LAUNCH_DURATION) return;
  hurryUntil = performance.now() + HURRY_DURATION;
  hurriedFramesLeft = HURRIED_FRAMES;
}

/** How long it takes until something else is to be done. */
function idleTime(): number {
  const now = performance.now();
  const untilTimer = timers.length > 0 ? Math.min(timers[0].time - now, 50) : 50;
  return stale.length > 0 ? Math.min(untilTimer, lastFrame + display.frameInterval - 2 - now) : untilTimer;
}

const isBefore = (a: Task, b: Task) => a.time < b.time || (a.time === b.time && a.order < b.order);

function settle(task: Task, at: int32) {
  while (at > 0) {
    const parent: int32 = (at - 1) >> 1;
    if (!isBefore(task, timers[parent])) break;
    (timers[at] = timers[parent]).index = at;
    at = parent;
  }
  for (;;) {
    let child: int32 = (at << 1) + 1;
    if (child >= timers.length) break;
    if (child + 1 < timers.length && isBefore(timers[child + 1], timers[child])) child++;
    if (!isBefore(timers[child], task)) break;
    (timers[at] = timers[child]).index = at;
    at = child;
  }
  (timers[at] = task).index = at;
}

function addTimer(task: Task, delay: number) {
  const time = performance.now() + delay;
  task.time = delay > PRECISE_DELAY ? Math.ceil(time / TIMER_ALIGNMENT) * TIMER_ALIGNMENT : time;
  timers.push(task);
  settle(task, timers.length - 1);
  if (task.time < alarmTime) setAlarm(task.time);
}

function removeTimer(task: Task) {
  const last = timers.pop()!;
  if (last !== task) settle(last, task.index);
  task.index = -1;
}

function setAlarm(time: number) {
  clearTimeout(alarm);
  alarmTime = time;
  alarm = setTimeout(ring, Math.ceil(time - performance.now()));
}

function ring() {
  const now = performance.now();
  alarmTime = Infinity;
  while (timers.length > 0 && timers[0].time <= now) {
    const task = timers[0];
    removeTimer(task);
    task.order = nextOrder++;
    visible.push(task);
  }
  if (timers.length > 0) setAlarm(timers[0].time);
  pump();
}

function postDelayed(delay: number, repeats: boolean, run: Callback, a?: unknown, b?: unknown, c?: unknown): Task {
  if (delay <= 0 && !repeats) return post(VISIBLE, run, a, b, c);
  const task = new Task(run, a, b, c, undefined);
  if (repeats) task.interval = Math.max(delay, 1);
  addTimer(task, Math.max(delay, 1));
  return task;
}

function cancel(task: Task) {
  task.run = null;
  task.a = task.b = task.c = task.d = undefined;
  if (task.index < 0) return;
  removeTimer(task);
  if (timers.length > 0) return;
  clearTimeout(alarm);
  alarmTime = Infinity;
}

export default {
  BLOCKING,
  VISIBLE,
  HOST,
  BACKGROUND,
  post,
  postDelayed,
  cancel,
  wantsFrame,
  beginsFrame,
  canFrameWait,
  scrolls,
  render,
  hurry,
  idleTime,
  setSuspended,
  finishCheckpoint,
  afterMicrotasks: (run: () => void) => void (afterMicrotasks.push(run), queuePump()),
  isSuspended: () => isSuspended,
};
