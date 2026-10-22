import { EventEmitter } from "node:events";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

(globalThis as any).note = (text: string) => log.push(text);
const hidden = (text: string): any => (0, eval)("(" + text + ")");

const seen: string[] = [];

function onNumber(n: number): void {
  seen.push("number " + show(n / 2) + " " + show(n + 1));
}

function onText(s: string): void {
  try {
    seen.push("text " + show(s.length) + " " + show(s.toUpperCase()));
  } catch (error) {
    seen.push("text threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function onPoint(p: { x: number; y: number }): void {
  try {
    seen.push("point " + show(p.x + p.y));
  } catch (error) {
    seen.push("point threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function onTwo(a: number, b: string): void {
  seen.push("two " + show(a + 1) + " " + show(b + "!"));
}

class Listener {
  total = 0;
  handle(n: number): void {
    this.total += n;
  }
  bound = (n: number): void => {
    this.total += n;
  };
}

function flush(label: string): void {
  console.log(label, seen.join(" | "));
  seen.length = 0;
}

const emitter = new EventEmitter();
emitter.on("number", onNumber);
emitter.on("text", onText);
emitter.on("point", onPoint);
emitter.on("two", onTwo);

onNumber(4);
onText("ab");
onPoint({ x: 1, y: 2 });
onTwo(1, "b");
flush("honest direct calls");
emitter.emit("number", 4);
emitter.emit("text", "ab");
emitter.emit("point", { x: 1, y: 2 });
emitter.emit("two", 1, "b");
flush("honest events");
for (let i = 0; i < 2000; i++) emitter.emit("number", i);
console.log("2000 honest events", seen.length, seen[1999]);
seen.length = 0;

for (const text of ["'8'", "null", "undefined", "-0", "[8]", "{ valueOf() { return 8; } }", "true"]) {
  emitter.emit("number", hidden(text));
  flush("number gets " + text);
}
attempt("number gets a bigint", () => emitter.emit("number", 8n));
seen.length = 0;
emitter.emit("number");
flush("number gets nothing");
for (const text of ["5", "null", "['a', 'b']", "new String('ab')", "{ length: 1, toUpperCase() { return 7; } }"]) {
  emitter.emit("text", hidden(text));
  flush("text gets " + text);
}
for (const text of ["{ x: '1', y: 2 }", "{ y: 2 }", "null", "5", "[1, 2]"]) {
  emitter.emit("point", hidden(text));
  flush("point gets " + text);
}
emitter.emit("two", "b", 1);
emitter.emit("two", 1);
emitter.emit("two", 1, "b", "c");
flush("two gets them crossed, short and long");

const listener = new Listener();
emitter.on("bound", listener.bound);
emitter.emit("bound", 1);
emitter.emit("bound", "2");
emitter.emit("bound", 3);
console.log("a bound listener", show(listener.total));
emitter.on("method", listener.handle);
attempt("a method as a listener gets the emitter as this", () => {
  emitter.emit("method", 1);
  return show((emitter as any).total);
});

const target = new EventTarget();
target.addEventListener("custom", event => {
  const detail: number = (event as CustomEvent).detail;
  seen.push("detail " + show(detail + 1));
});
target.dispatchEvent(new CustomEvent("custom", { detail: 1 }));
target.dispatchEvent(new CustomEvent("custom", { detail: "1" }));
target.dispatchEvent(new CustomEvent("custom"));
target.dispatchEvent(new Event("custom"));
flush("an event target");

await new Promise<void>(resolve => {
  process.nextTick(onNumber, hidden("'6'"));
  process.nextTick(onTwo, hidden("'x'"), hidden("7"));
  setTimeout(onNumber, 0, hidden("'10'"));
  setTimeout(resolve, 1);
});
flush("ticks and timers");
queueMicrotask(() => onNumber(hidden("'12'")));
await null;
flush("a microtask");
