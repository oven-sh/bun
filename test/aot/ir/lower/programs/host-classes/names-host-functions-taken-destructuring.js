// RUN: lower
// OPTIONS: builtin-modules

// Prints the name, the length and the text of functions of Buffer, Bun, console, process and node:module. Each is taken out of its holder by a pattern.
const show = (label, fn) =>
  console.log(label, JSON.stringify([fn.name, fn.length, Reflect.ownKeys(fn).map(String), String(fn)]));

const { alloc, from, isBuffer } = Buffer;
const { toJSON, write: writeBytes } = Buffer.prototype;
const { file, peek, Glob } = Bun;
const { status } = peek;
const { match, scan, scanSync } = Glob.prototype;
const { log, write, [Symbol.asyncIterator]: lines } = console;
const { cwd, loadEnvFile, _rawDebug } = process;
const { _initPaths } = require("node:module");

show("alloc", alloc);
show("from", from);
show("isBuffer", isBuffer);
show("toJSON", toJSON);
show("writeBytes", writeBytes);
show("file", file);
show("peek", peek);
show("status", status);
show("match", match);
show("scan", scan);
show("scanSync", scanSync);
show("log", log);
show("write", write);
show("lines", lines);
show("cwd", cwd);
show("loadEnvFile", loadEnvFile);
show("_rawDebug", _rawDebug);
show("_initPaths", _initPaths);

// GENERATED: show
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|number|string|symbol|bigint|object flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|number|string|symbol|bigint|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = Builtin builtin=JSON
// CHECK-NEXT: v8 = PropGet v7 key="stringify"
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v1 key="name"
// CHECK-NEXT: v11 = PropGet v1 key="length"
// CHECK-NEXT: v12 = Builtin builtin=Reflect
// CHECK-NEXT: v13 = Builtin builtin=ReflectOwnKeys
// CHECK-NEXT: v14 = Call v13, v12, v1 calleeName="Reflect.ownKeys"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|Array<undefined|null|string|symbol> flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v15 key="map"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v18 = Builtin builtin=String
// CHECK-NEXT: v19 = Call v17, v15, v18 calleeKey="map" calleeName="map"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v21 = Builtin builtin=String
// CHECK-NEXT: v22 = Call v21, -, v1 calleeName="String"
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v24 = NewArray v10, v11, v20, v23 contents=anything
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v26 = Call v9, v7, v25 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v28 = Call v6, v4, v0, v27 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Return v28
// CHECK-NEXT: }
