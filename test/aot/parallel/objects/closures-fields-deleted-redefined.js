// A closure that is stored in a field at creation may be made only when it is first read. Here such fields are deleted, redefined, replaced by other functions and by values that
// are no functions, before and after the first read, by code of the program and by evaluated text. The other fields and the methods stay what they were.
function outcome(f) { try { const v = f(); return typeof v === "function" ? "function " + v.name : JSON.stringify(v) ?? "undefined"; } catch (e) { return "throws " + e.name; } }
function show(label, ...parts) { console.log(label + ": " + parts.map(String).join(" | ")); }

class Reader {
  count = 0;
  onData = () => ++this.count;
  onEnd;
  onError = () => -1;
  constructor(id) { this.id = id; this.onEnd = () => this.count + this.id; }
  run() { return this.onData() + this.onEnd() + this.onError(); }
}
function makeHandlers(id) { const o = { id, read: () => o.id + 1, plain: () => 7 }; return o; }

const text = (0, eval)(`({
  remove(o, k) { return delete o[k]; },
  accessor(o, k) { Object.defineProperty(o, k, { get() { return () => "from a getter " + this.id; }, enumerable: true, configurable: true }); },
  hidden(o, k) { Object.defineProperty(o, k, { enumerable: false }); },
  readOnly(o, k) { Object.defineProperty(o, k, { writable: false }); },
  number(o, k) { o[k] = 5; },
  nothing(o, k) { o[k] = undefined; },
  other(o, k) { o[k] = function other() { return 100; }; },
  object(o, k) { o[k] = { call: 1 }; },
  text(o, k) { o[k] = "text"; },
  removeAndAdd(o, k) { delete o[k]; o[k] = function again() { return 200; }; },
  inherit(o, k) { delete o[k]; Object.getPrototypeOf(o)[k] = function inherited() { return 300; }; },
  frozen(o, k) { Object.freeze(o); },
  call(o, k) { return o[k](); },
})`);
const own = {
  remove(o, k) { delete o[k]; },
  accessor(o, k) { Object.defineProperty(o, k, { get() { return () => "from a getter " + this.id; }, enumerable: true, configurable: true }); },
  number(o, k) { o[k] = 5; },
  other(o, k) { o[k] = function other() { return 100; }; },
  removeAndAdd(o, k) { delete o[k]; o[k] = function again() { return 200; }; },
  removeByName(o, k) { if (k === "onData") delete o.onData; else if (k === "onEnd") delete o.onEnd; else if (k === "onError") delete o.onError; else if (k === "read") delete o.read; else delete o.plain; },
  storeByName(o, k) { if (k === "onData") o.onData = 1; else if (k === "onEnd") o.onEnd = null; else if (k === "onError") o.onError = "e"; else if (k === "read") o.read = 2.5; else o.plain = true; },
};

function useReader(r) { return [outcome(() => r.onData), outcome(() => r.onData()), outcome(() => r.onEnd()), outcome(() => r.onError()), outcome(() => r.run()), r.count, r.id].join(" "); }
function useHandlers(h) { return [outcome(() => h.read), outcome(() => h.read()), outcome(() => h.plain()), h.id].join(" "); }
function seen(o) { return [Reflect.ownKeys(o).join(), Object.keys(o).join(), JSON.stringify(o), Object.keys({ ...o }).join(), Object.entries(o).map(([k, v]) => k + "=" + typeof v).join(), "onData" in o, Object.hasOwn(o, "plain")].join(" ; "); }

for (const [by, alterations] of [["text", text], ["own", own]]) {
  for (const name of Object.keys(alterations)) {
    if (name === "call") continue;
    for (const readFirst of [false, true]) {
      for (const key of ["onData", "onEnd", "onError"]) {
        const r = new Reader(10);
        const kept = readFirst ? r[key] : undefined;
        alterations[name](r, key);
        show(["reader", by, name, key, readFirst ? "read first" : "never read"].join(", "), useReader(r), seen(r), outcome(() => text.call(r, key)), kept ? outcome(() => kept()) : "-", kept === r[key]);
        delete Reader.prototype[key];
      }
      for (const key of name === "inherit" ? [] : ["read", "plain"]) {
        const h = makeHandlers(10);
        const kept = readFirst ? h[key] : undefined;
        alterations[name](h, key);
        show(["handlers", by, name, key, readFirst ? "read first" : "never read"].join(", "), useHandlers(h), seen(h), outcome(() => text.call(h, key)), kept ? outcome(() => kept()) : "-", kept === h[key]);
      }
    }
  }
}

// One function per object, one identity, also beside altered neighbors and across collections.
const readers = [];
for (let i = 0; i < 1000; i++) {
  const r = new Reader(i);
  if (i % 3 === 0) text.remove(r, "onError");
  if (i % 5 === 0) text.number(r, "onData");
  if (i % 7 === 0) text.accessor(r, "onEnd");
  readers.push(r);
}
Bun.gc(true);
let right = 0;
for (let i = 0; i < readers.length; i++) {
  const r = readers[i];
  const a = i % 3 === 0 ? r.onError === undefined : r.onError === r.onError && r.onError() === -1;
  const b = i % 5 === 0 ? r.onData === 5 : r.onData() === 1 && r.count === 1;
  const c = i % 7 === 0 ? r.onEnd() === "from a getter " + i : r.onEnd() === r.count + i;
  if (a && b && c) right++;
}
show("1000 readers", right);
