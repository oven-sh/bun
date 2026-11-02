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
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=function
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v3 = Builtin builtin=Reflect
// CHECK-NEXT: v4 = Builtin builtin=ReflectOwnKeys
// CHECK-NEXT: v5 = Call v4, v3, v2 calleeName="Reflect.ownKeys"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|Array<undefined|null|string|symbol> flags=[IsExpected]}
// CHECK-NEXT: v7 = PropGet v6 key="map"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v9 = NewClosure v2 function=[[f_3]]
// CHECK-NEXT: v10 = Call v8, v6, v9 calleeKey="map" calleeName="map"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|Array<undefined|null|Array> flags=[IsExpected]}
// CHECK-NEXT: v12 = Builtin builtin=JSON
// CHECK-NEXT: v13 = PropGet v12 key="stringify"
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v15 = Builtin builtin=GlobalThis
// CHECK-NEXT: v16 = PropGet v15 key="Function" [isFreeName]
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(Function) flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="prototype"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(FunctionPrototype) flags=[IsExpected]}
// CHECK-NEXT: v20 = PropGet v19 key="toString"
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(FunctionPrototypeToString) flags=[IsExpected]}
// CHECK-NEXT: v22 = PropGet v21 key="call"
// CHECK-NEXT: v23 = Convert v22 declared={type=builtin(FunctionPrototypeCall) flags=[IsExpected]}
// CHECK-NEXT: v24 = Call v23, v21, v2 calleeKey="call" calleeName="Function.prototype.toString.call"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v26 = NewArray v11, v25 contents=anything
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|Array<undefined|null|string|Array<undefined|null|Array>> flags=[IsExpected]}
// CHECK-NEXT: v28 = Call v14, v12, v27 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v29
// CHECK-NEXT: b4(v30):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v31 = TypeOf v30
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v32
// CHECK-NEXT: }
