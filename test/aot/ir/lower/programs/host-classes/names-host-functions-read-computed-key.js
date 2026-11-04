// RUN: lower
// OPTIONS: builtin-modules

// Prints the own properties and the text of functions of Buffer, Bun, console, process and two modules. Each is read through a key out of a list.
const describe = fn => {
  if (typeof fn !== "function") return typeof fn;
  const properties = Reflect.ownKeys(fn).map(key => {
    const { value, writable, enumerable, configurable } = Reflect.getOwnPropertyDescriptor(fn, key);
    return [
      String(key),
      typeof value === "function" || typeof value === "object" ? typeof value : value,
      writable,
      enumerable,
      configurable,
    ];
  });
  return JSON.stringify([properties, Function.prototype.toString.call(fn)]);
};
const holders = {
  Buffer,
  "Buffer.prototype": Buffer.prototype,
  Bun,
  "Bun.peek": Bun.peek,
  "Bun.Glob.prototype": Bun.Glob.prototype,
  console,
  process,
  "node:console": require("node:console"),
  "node:module": require("node:module"),
};
const members = [
  ["Buffer", "alloc"],
  ["Buffer", "from"],
  ["Buffer", "isBuffer"],
  ["Buffer.prototype", "toJSON"],
  ["Buffer.prototype", "write"],
  ["Bun", "file"],
  ["Bun", "peek"],
  ["Bun.peek", "status"],
  ["Bun.Glob.prototype", "match"],
  ["Bun.Glob.prototype", "scan"],
  ["Bun.Glob.prototype", "scanSync"],
  ["console", "log"],
  ["console", "write"],
  ["console", Symbol.asyncIterator],
  ["process", "cwd"],
  ["process", "loadEnvFile"],
  ["process", "_rawDebug"],
  ["node:console", "write"],
  ["node:module", "_initPaths"],
];
for (const [holder, key] of members) console.log(holder, String(key), describe(holders[holder][key]));

// GENERATED: describe
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: v1 = TypeTest v0 testedType=function
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = NarrowByTest v0, v2
// CHECK-NEXT: v4 = Builtin builtin=Reflect
// CHECK-NEXT: v5 = Builtin builtin=ReflectOwnKeys
// CHECK-NEXT: v6 = Call v5, v4, v3 calleeName="Reflect.ownKeys"
// CHECK-NEXT: v7 = PropGet v6 key="map"
// CHECK-NEXT: v8 = NewClosure v3 function=[[f_1]]
// CHECK-NEXT: v9 = Call v7, v6, v8 calleeKey="map" calleeName="map"
// CHECK-NEXT: v10 = Builtin builtin=JSON
// CHECK-NEXT: v11 = PropGet v10 key="stringify"
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v13 = Builtin builtin=GlobalThis
// CHECK-NEXT: v14 = PropGet v13 key="Function" [isFreeName]
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(Function) flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v15 key="prototype"
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(FunctionPrototype) flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="toString"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(FunctionPrototypeToString) flags=[IsExpected]}
// CHECK-NEXT: v20 = PropGet v19 key="call"
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(FunctionPrototypeCall) flags=[IsExpected]}
// CHECK-NEXT: v22 = Call v21, v19, v3 calleeKey="call" calleeName="Function.prototype.toString.call"
// CHECK-NEXT: v23 = NewArray v9, v22 contents=anything
// CHECK-NEXT: v24 = Call v12, v10, v23 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: Return v24
// CHECK-NEXT: b2(v25):
// CHECK-NEXT: v26 = NarrowByTest v0, v25
// CHECK-NEXT: v27 = TypeOf v26
// CHECK-NEXT: Return v27
// CHECK-NEXT: }
