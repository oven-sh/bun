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

function emitEvent(ph: string, cat: string, name: string, id?: number, data?: unknown): void {
  emitEventWithArgs(ph, cat, name, id, data === undefined ? {} : { data });
}

// Like `emitEvent`, but `args` lands at the top level of the event's `args` object instead of under `args.data`.
function emitEventWithArgs(ph: string, cat: string, name: string, id?: number, args?: unknown): void {
  const event: Record<string, unknown> = {
    pid: process.pid,
    tid,
    ts: now(),
    ph,
    cat,
    name,
  };
  if (id !== undefined) event.id = "0x" + id.toString(16);
  event.args = args === undefined ? {} : args;
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
};
