import { EventEmitter } from "node:events";
import { honest } from "./honest.js";
import { labelled, log, noted, parsed, scaled, sizeOf, total } from "./library.js";
import { attempt, show } from "./show.js";

console.log("this file is strict:", (function () {
  return this === undefined;
})());

for (let i = 0; i < 2000; i++) honest();
log.length = 0;
attempt("honest", honest);
attempt("map(scaled)", () => [1, 2, 3].map(scaled));
attempt("map(labelled)", () => [1, 2, 3].map(labelled));
attempt("map(parsed)", () => ["10", "10", "10", "10"].map(parsed));
attempt("map(sizeOf)", () => [[1], "ab", { length: "long" }, 5].map(sizeOf));
attempt("Array.from(scaled)", () => Array.from({ length: 3 }, scaled));
attempt("Array.from(a set, labelled)", () => Array.from(new Set(["a"]), labelled));
attempt("reduce(total)", () => [1, 2, 3].reduce(total));
attempt("reduce(total) over texts", () => ["1", 2, 3].reduce(total));
attempt("reduce(scaled)", () => [1, 2, 3].reduce(scaled));
attempt("sort(total)", () => [3, 1, 2].sort(total));
attempt("replace(labelled)", () => "a-b".replace(/[ab]/g, labelled));
attempt("replace(scaled)", () => "2-3".replace(/\d/g, scaled));
attempt("a map's forEach(noted)", () => (new Map([["key", 1]]).forEach(noted), log.splice(0)));
attempt("a set's forEach(noted)", () => (new Set(["only"]).forEach(noted), log.splice(0)));
attempt("JSON.parse(noted)", () => [JSON.parse('{"a":[1]}', noted), log.splice(0)]);
attempt("JSON.stringify(noted)", () => [JSON.stringify({ a: 1 }, noted), log.splice(0)]);
attempt("flatMap(scaled)", () => [1, 2].flatMap(scaled));
attempt("find(sizeOf)", () => ["", [], "ab"].find(sizeOf));
attempt("a typed array's map(scaled)", () => new Uint8Array([1, 2, 200]).map(scaled));
attempt("Reflect.apply(scaled)", () => Reflect.apply(scaled, null, ["3", "4"]));
attempt("scaled.call", () => scaled.call(null, 3n, 4n));
attempt("scaled.bind", () => scaled.bind(null, "3")());

const emitter = new EventEmitter();
emitter.on("noted", noted);
emitter.emit("noted");
emitter.emit("noted", "text", [1], 3);
console.log("an emitter", log.splice(0).join(", "));
const target = new EventTarget();
target.addEventListener("noted", noted);
target.dispatchEvent(new Event("noted"));
console.log("an event target", log.splice(0).join(", "));

console.log("then(scaled)", show(await Promise.resolve(4).then(scaled)));
console.log("then(scaled) of a text", show(await Promise.resolve("4").then(scaled)));
console.log("then(sizeOf) of nothing", await Promise.resolve().then(sizeOf).catch(error => "threw " + error.constructor.name));
console.log("catch(sizeOf)", show(await Promise.reject("abc").catch(sizeOf)));
await new Promise(resolve => setTimeout((...operands) => resolve(noted(...operands)), 0, "from a timer", 1));
await new Promise(resolve => setTimeout(noted, 0) && setTimeout(resolve, 1));
await new Promise(resolve => process.nextTick((...operands) => resolve(noted(...operands)), { from: "a tick" }));
await new Promise(resolve => queueMicrotask(() => resolve(noted())));
console.log("timers and ticks", log.splice(0).join(", "));
attempt("honest again", honest);
