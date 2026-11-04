// a built-in lists the keys and values of a record, or asks it for `then`, between a store into a variable and the read of it; then a record of the same shape comes with a getter that stores into the variable
let last = "start";
function make(a, b) { return { a, b }; }
function keysOf(record) { last = "before"; const keys = Object.keys(record); return keys.join() + ":" + last; }
function valuesOf(record) { last = "before"; const values = Object.values(record); return values.join() + ":" + last; }
function entriesOf(record) { last = "before"; const entries = Object.entries(record); return entries.join("|") + ":" + last; }
async function settled(record) { last = "before"; const promise = Promise.resolve(record); const seen = last; return (await promise === record) + ":" + seen; }
const hostile = make(1, 2);
async function deed(record) { console.log(keysOf(record), valuesOf(record), entriesOf(record), await settled(record)); }
await deed(make(1, 2));
for (let turn = 0; turn < 3; turn++)
  await deed(make(turn, "x"));
Object.defineProperty(hostile, "b", { get() { last = "getter ran"; return 9; }, enumerable: true });
await deed(hostile);
const thenable = make(1, 2);
Object.defineProperty(thenable, "then", { get() { last = "then was read"; return undefined; } });
await deed(thenable);
await deed(new Proxy(make(1, 2), { ownKeys(t) { last = "trap ran"; return Reflect.ownKeys(t); } }));
