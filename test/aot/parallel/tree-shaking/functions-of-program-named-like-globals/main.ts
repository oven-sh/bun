// A function, a class or an import of the program that has the name of a global hides the global in its file. Each call here means the program's own, and is the only reference to it.
import { setTimeout, URL, Buffer, structuredClone } from "./mine";

function fetch(what: string) { return "my fetch of " + what; }
function parseInt(text: string) { return "my parseInt of " + text; }
function queueMicrotask() { return "my queueMicrotask"; }
function isNaN() { return "my isNaN"; }
function String(value: unknown) { return "my String"; }
class Map { size = "my Map"; }
class Promise2 {}
class Error { message = "my Error"; }
class Date { static now() { return "my Date.now"; } }
const Symbol = (name: string) => "my Symbol " + name;
const JSON = { stringify: () => "my JSON.stringify" };
const Math = { max: () => "my Math.max" };
const console2 = console;
const Reflect = { ownKeys: () => "my Reflect.ownKeys" };
const Bun = { version: "my Bun" };
const process = { platform: "my process" };

console2.log(fetch("x"), parseInt("1"), queueMicrotask(), isNaN(), String(1));
console2.log(new Map().size, new Error().message, Date.now(), Symbol("s"), JSON.stringify(), Math.max(), Reflect.ownKeys(), Bun.version, process.platform);
console2.log(setTimeout(), new URL().href, Buffer.from(), structuredClone());
console2.log(typeof globalThis.fetch, globalThis.parseInt("7"), new globalThis.Map().size, typeof globalThis.Bun.version);
