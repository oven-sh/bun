import { nextTurns } from "../host.ts";
const names = ["close", "error", "end", "finish", "data", "drain", "unpipe", "readable"];
function listener() {}
function add(holder, type, fn) {
  let events = holder.events;
  if (!events) events = holder.events = { close: undefined, error: undefined, data: undefined, end: undefined, readable: undefined };
  else if (events.newListener) holder.count += 100;
  const existing = events[type];
  if (existing === undefined) {
    events[type] = fn;
    holder.count++;
    return;
  }
  events[type] = typeof existing === "function" ? [existing, fn] : [...existing, fn];
}
function bench(n) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const holder = { events: undefined, count: 0 };
    for (let k = 0; k < 8; k++) add(holder, names[k], listener);
    add(holder, names[i & 7], listener);
    s += holder.count;
  }
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n) & 1023;
console.log(check);
