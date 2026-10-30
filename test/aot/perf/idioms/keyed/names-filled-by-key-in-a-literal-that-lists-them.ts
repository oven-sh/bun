import { nextTurns } from "../host.ts";
type Listener = () => void;
type Held = Listener | Listener[] | undefined;
interface Events {
  [name: string]: Held;
  close: Held;
  error: Held;
  data: Held;
  end: Held;
  readable: Held;
}
interface Holder {
  events: Events | undefined;
  count: number;
}
const names = ["close", "error", "end", "finish", "data", "drain", "unpipe", "readable"];
function listener() {}
function room(): Events {
  return { close: undefined, error: undefined, data: undefined, end: undefined, readable: undefined };
}
function add(holder: Holder, type: string, fn: Listener) {
  let events = holder.events;
  if (!events) events = holder.events = room();
  else if (events.newListener) holder.count += 100;
  const existing = events[type];
  if (existing === undefined) {
    events[type] = fn;
    holder.count++;
    return;
  }
  events[type] = typeof existing === "function" ? [existing, fn] : [...existing, fn];
}
function bench(n: number) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const holder: Holder = { events: undefined, count: 0 };
    for (let k = 0; k < 8; k++) add(holder, names[k], listener);
    add(holder, names[i & 7], listener);
    s += holder.count;
  }
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n) & 1023;
console.log(check);
