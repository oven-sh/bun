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
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|number|string|symbol|bigint|object flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|number|string|symbol|bigint|object):
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
// CHECK-NEXT: v15 = PropGet v14 key="map"
// CHECK-NEXT: v16 = Builtin builtin=String
// CHECK-NEXT: v17 = Call v15, v14, v16 calleeKey="map" calleeName="map"
// CHECK-NEXT: v18 = Builtin builtin=String
// CHECK-NEXT: v19 = Call v18, -, v1 calleeName="String"
// CHECK-NEXT: v20 = NewArray v10, v11, v17, v19 contents=anything
// CHECK-NEXT: v21 = Call v9, v7, v20 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v22 = Call v6, v4, v0, v21 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
