// Subclasses of EventTarget, Event, EventEmitter, URL, Response and DOMException with fields, methods, getters and a private field: the host creates the object, the fields are ordinary properties.
import { EventEmitter } from "node:events";
const print = (value: unknown): void => console.log(String(value));
const gc = (): void => Bun.gc(true);
class Hub extends EventTarget {
  count = 0;
  name: string;
  #seen = 0;
  constructor(name: string) { super(); this.name = name; }
  fire(kind: string) { this.count++; return this.dispatchEvent(new Ping(kind, this.count)); }
  saw() { return ++this.#seen; }
}
class Ping extends Event {
  n: number;
  constructor(kind: string, n: number) { super(kind); this.n = n; }
  twice() { return this.n * 2; }
}
const h = new Hub("hub");
h.addEventListener("a", (e) => { print((e as Ping).n + ":" + (e as Ping).twice() + ":" + e.type + ":" + (e instanceof Ping)); h.saw(); });
print(h.fire("a"));
print(h.fire("a"));
print(h.count);
print(h.name);
print(h.saw());
print(h instanceof Hub);
print(h instanceof EventTarget);
print(Object.keys(h).join(","));
class Bus extends EventEmitter {
  sent = 0;
  send(v: number) { this.sent++; return this.emit("v", v); }
}
const b = new Bus();
b.on("v", (v: number) => print("got " + v));
print(b.send(3));
print(b.sent);
print(b instanceof EventEmitter);
class Link extends URL {
  tag = "t";
  get both() { return this.tag + this.host; }
}
const u = new Link("https://example.com/x");
print(u.both);
print(u.pathname);
print(u instanceof URL);
class Reply extends Response {
  note = "n";
}
const r = new Reply("body", { status: 201 });
print(r.status);
print(r.note);
print(await r.text());
class AbortedError extends DOMException {
  extra = 5;
}
const ae = new AbortedError("gone", "AbortError");
print(ae.name);
print(ae.message);
print(ae.extra);
print(ae instanceof Error);
const all: Hub[] = [];
for (let i = 0; i < 2000; i++) all.push(new Hub("h" + i));
gc();
let sum = 0;
for (let i = 0; i < all.length; i++) sum += all[i].name.length + all[i].count + all[i].saw();
print(sum);
