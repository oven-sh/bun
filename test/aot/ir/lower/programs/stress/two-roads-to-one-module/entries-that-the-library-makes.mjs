// RUN: lower
// OPTIONS: builtin-modules

// process.stdout, process.stdin, console.Console and a few more are made by code of the library and put in their places by native code. Each is reached here by its place and by a
// second road that goes through the library's own code: a method that answers `this`, a listener's `this`, pipe's answer, a constructor property.
import { createRequire } from "node:module";
import { Readable } from "node:stream";
const require = createRequire(import.meta.url);
const lines = [];
function same(name, answer) {
  lines.push(name + " " + answer);
}
function nothing() {}
same("stdout.on", process.stdout.on("drain", nothing) === process.stdout);
same("stdout.once", process.stdout.once("drain", nothing) === process.stdout);
same("stdout.off", process.stdout.off("drain", nothing) === process.stdout);
same("stdout.setMaxListeners", process.stdout.setMaxListeners(20) === process.stdout);
same("stdout.setDefaultEncoding", process.stdout.setDefaultEncoding("utf8") === process.stdout);
same("stderr.on", process.stderr.on("drain", nothing) === process.stderr);
same("stderr.removeAllListeners", process.stderr.removeAllListeners("drain") === process.stderr);
same("stdout stderr", process.stdout === process.stderr);
same("stdin.pause", process.stdin.pause() === process.stdin);
same("stdin.setEncoding", process.stdin.setEncoding("utf8") === process.stdin);
same("stdin.on", process.stdin.on("nothing", nothing) === process.stdin);
same("stdin stdout", process.stdin === process.stdout);
let seen;
process.stdout.once("mine", function () {
  seen = this;
});
process.stdout.emit("mine");
same("listener's this", seen === process.stdout);
const source = new Readable({ read() {} });
same("pipe's answer", source.pipe(process.stdout) === process.stdout);
source.unpipe(process.stdout);
const made = new console.Console(process.stdout, process.stderr);
same("Console's _stdout", made._stdout === process.stdout);
same("Console's _stderr", made._stderr === process.stderr);
same("console.Console require", console.Console === require("node:console").Console);
same("made instanceof", made instanceof console.Console);
same("made.Console", made.Console === console.Console);
same("console._stdout.on", console._stdout.on("drain", nothing) === process.stdout);
same("stdout.constructor.prototype", Object.getPrototypeOf(process.stdout) === process.stdout.constructor.prototype);
const flags = process.allowedNodeEnvironmentFlags;
same("flags twice", flags === process.allowedNodeEnvironmentFlags);
same("flags.add", flags.add("--mine") === process.allowedNodeEnvironmentFlags);
same("finalization twice", process.finalization === globalThis.process.finalization);
same("wrapper twice", require("node:module").wrapper === require("node:module").wrapper);
same("peek.status twice", Bun.peek.status === globalThis.Bun.peek.status);
same("nextTick.call", process.nextTick.call === Function.prototype.call);
same("nextTick name", process.nextTick.name);
same("typeof nextTick", typeof process.nextTick);
const ticks = [process.nextTick, process.loadEnvFile, process._rawDebug, Bun.peek];
same("in an array", ticks[0] === process.nextTick && ticks[1] === process.loadEnvFile && ticks[2] === process._rawDebug && ticks[3] === Bun.peek);
same("indexOf", ticks.indexOf(process.nextTick) + " " + ticks.indexOf(Bun.peek) + " " + ticks.includes(process._rawDebug));
const table = new Map([[process.nextTick, "tick"], [process.stdout, "out"], [console.Console, "console"]]);
same("in a map", table.get(process.nextTick) + " " + table.get(process.stdout) + " " + table.get(console.Console));
switch (ticks[0]) {
  case Bun.peek:
    same("switch", "peek");
    break;
  case process.nextTick:
    same("switch", "nextTick");
    break;
  default:
    same("switch", "none");
}
console.log(lines.join("\n"));
process.exit(0);

// GENERATED: same read
// CHECK-LABEL: function {{*}}name="same"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="lines"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v6 = String string=" "
// CHECK-NEXT: v7 = Add v0, v6
// CHECK-NEXT: v8 = Add v7, v1
// CHECK-NEXT: v9 = Call v5, v3, v8 calleeKey="push" calleeName="lines.push"
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
