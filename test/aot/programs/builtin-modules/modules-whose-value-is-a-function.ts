// A module of Bun whose value is a function: node:events, node:assert, node:stream. The function and its members are called and constructed, by a named import, by the default import and by require.
import { EventEmitter } from "node:events";
import Emitter from "node:events";
import assert from "node:assert";
import Stream, { Readable } from "node:stream";
import { createRequire } from "node:module";
const emitter = new EventEmitter();
emitter.on("x", (p: number) => console.log("named", p));
emitter.emit("x", 1);
const other = new Emitter();
other.once("y", (p: string) => console.log("default", p));
other.emit("y", "a");
console.log(Emitter === EventEmitter, (Emitter as any).EventEmitter === EventEmitter, typeof Emitter.once, emitter instanceof Emitter);
class Heir extends EventEmitter { name = "heir"; }
const heir = new Heir();
heir.on("z", function (this: Heir) { console.log("heir", this.name, this.listenerCount("z")); });
heir.emit("z");
assert(true);
assert.ok(1);
assert.strictEqual(1, 1);
try { assert(false, "refused"); } catch (error) { console.log((error as Error).message); }
console.log(typeof Stream, new Stream() instanceof EventEmitter, (Stream as any).Readable === Readable);
const required = createRequire(import.meta.url)("node:events");
console.log(required === EventEmitter, new required() instanceof EventEmitter);
