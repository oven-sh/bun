// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2
// STATISTIC: SourceFilesInferred = 1
// STATISTIC: SourceFilesData = 1

// FILE: main.ts
// require.cache lists none of the modules of the executable, however it is walked, and no read of it throws. An executable built without --aot does the same.
const typed: { unrelated(): string } = require("./typed.ts");
const plain: { name: string } = require("./plain.cjs");
const data: { a: number } = require("./data.json");
const cache = require.cache as Record<string, unknown>;
function attempt(label: string, run: () => unknown) {
  try {
    console.log(label + ":", run());
  } catch (error: any) {
    console.log(label + ": throws", error.constructor.name, error.message);
  }
}
const last = (path: string) => path.split(/[\\/]/).pop();
attempt("keys", () => Object.keys(cache).map(last).join());
attempt("own names", () => Object.getOwnPropertyNames(cache).map(last).join());
attempt("own keys", () => Reflect.ownKeys(cache).map(String).map(last).join());
attempt("for in", () => {
  const seen: unknown[] = [];
  for (const key in cache) seen.push(last(key));
  return seen.join();
});
attempt("each key read", () =>
  Object.keys(cache)
    .map(key => typeof cache[key])
    .join(),
);
attempt("entries", () =>
  Object.entries(cache)
    .map(([key, value]) => last(key) + ":" + typeof value)
    .join(),
);
attempt("values", () =>
  Object.values(cache)
    .map(value => typeof value)
    .join(),
);
attempt("spread", () =>
  Object.keys({ ...cache })
    .map(last)
    .join(),
);
attempt("assign", () => Object.keys(Object.assign({}, cache)).map(last).join());
attempt("descriptors", () => Object.keys(Object.getOwnPropertyDescriptors(cache)).map(last).join());
for (const path of ["./typed.ts", "./plain.cjs", "./data.json"]) {
  attempt("read " + path, () => typeof cache[require.resolve(path)]);
  attempt("in " + path, () => require.resolve(path) in cache);
  attempt("has own " + path, () => Object.hasOwn(cache, require.resolve(path)));
  attempt("as written " + path, () => typeof cache[path]);
}
attempt("this file", () => typeof cache[__filename]);
attempt("no such file", () => typeof cache["/no/such/file.js"]);
attempt("a built-in module", () => typeof cache["node:fs"] + " " + typeof cache["fs"]);
attempt("Module._cache", () => require("node:module")._cache === cache);
console.log(typed.unrelated(), plain.name, data.a);

// FILE: data.json
{ "a": 1 }

// FILE: plain.cjs
exports.name = "plain";

// FILE: typed.ts
export function unrelated() {
  return "unrelated";
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: attempt last
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=":"
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = Call v1 calleeName="run"
// CHECK-NEXT: v10 = Call v6, v4, v8, v9 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v11 = CatchValue
// CHECK-NEXT: v12 = Builtin builtin=GlobalThis
// CHECK-NEXT: v13 = PropGet v12 key="console" [isFreeName]
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v14 key="log"
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v17 = String string=": throws"
// CHECK-NEXT: v18 = Add v0, v17
// CHECK-NEXT: v19 = PropGet v11 key="constructor"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|number|string|symbol|bigint|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v21 = PropGet v20 key="name"
// CHECK-NEXT: v22 = Convert v11 declared={type=undefined|null|number|string|symbol|bigint|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v23 = PropGet v22 key="message"
// CHECK-NEXT: v24 = Call v16, v14, v18, v21, v23 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v25 = Undefined
// CHECK-NEXT: Return v25
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="last"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy, IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_7]] flags=[OmitsNull]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="split"
// CHECK-NEXT: v2 = NewRegExp pattern="[\\\\/]"
// CHECK-NEXT: v3 = Call v1, v0, v2 calleeKey="split" calleeName="path.split"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|string> site=[[w_9]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v5 = PropGet v4 key="pop"
// CHECK-NEXT: v6 = Call v5, v4 calleeKey="pop" calleeName="pop"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
