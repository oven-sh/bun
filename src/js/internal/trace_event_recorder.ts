// What an emitter of trace events needs: which categories are enabled, and the buffer of events.

// Enabled categories with refcounts.
const categoryRefs = new Map<string, number>();

const events: object[] = [];
let tid = 1;

function now(): number {
  // Trace-event timestamps are in microseconds.
  return Math.round(performance.now() * 1000);
}

function setTid(value: number): void {
  tid = value;
}

function getTid(): number {
  return tid;
}

function isCategoryGroupEnabled(cat: string): boolean {
  if (categoryRefs.size === 0) return false;
  if (categoryRefs.$has(cat)) return true;
  if (!cat.includes(",")) return false;
  for (const part of cat.split(",")) {
    if (categoryRefs.$has(part)) return true;
  }
  return false;
}

// The timers keep a log of their own while `node.async_hooks` is traced. `internal/trace_events` sets this to
// what moves that log into `events`, and every emitter calls it first, so that `events` stays in the order of time.
let takeOlderEvents: (() => void) | undefined;

function setOlderEvents(take: (() => void) | undefined): void {
  takeOlderEvents = take;
}

function emitEvent(ph: string, cat: string, name: string, id?: number, data?: unknown): void {
  emitEventWithArgs(ph, cat, name, id, data === undefined ? {} : { data });
}

// Like `emitEvent`, but `args` lands at the top level of the event's `args` object instead of under `args.data`.
function emitEventWithArgs(ph: string, cat: string, name: string, id?: number, args?: unknown): void {
  if (takeOlderEvents !== undefined) takeOlderEvents();
  pushEvent(now(), ph, cat, name, id, args === undefined ? {} : args);
}

// An event that happened at `ts`. It does not take the older events first: it is one of them.
function pushEvent(ts: number, ph: string, cat: string, name: string, id: number | undefined, args: unknown): void {
  const event: Record<string, unknown> = {
    pid: process.pid,
    tid,
    ts,
    ph,
    cat,
    name,
  };
  if (id !== undefined) event.id = "0x" + id.toString(16);
  event.args = args;
  events.push(event);
}

export default {
  categoryRefs,
  events,
  now,
  setTid,
  getTid,
  isCategoryGroupEnabled,
  emitEvent,
  emitEventWithArgs,
  pushEvent,
  setOlderEvents,
};
