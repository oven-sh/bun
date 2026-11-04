// Every writer of these fields is known, so each field is typed by the one function that is stored into it, or a list of it. A store by key goes through a stub, which has to see that the value is that function.
// It reads the number of the function out of the closure. Left to the run time, each such store was a call: five a turn here.
// COUNT: operations <= 4167
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
  const existing = events[type];
  if (existing === undefined) {
    events[type] = fn;
    holder.count++;
    return;
  }
  events[type] = typeof existing === "function" ? [existing, fn] : [...existing, fn];
}
function turns(n: number) {
  let total = 0;
  for (let i = 0; i < n; i++) {
    const holder: Holder = { events: undefined, count: 0 };
    for (let k = 0; k < 8; k++) add(holder, names[k]!, listener);
    add(holder, names[i & 7]!, listener);
    total += holder.count + Object.keys(holder.events!).length;
  }
  return total;
}
console.log(turns(4000));
