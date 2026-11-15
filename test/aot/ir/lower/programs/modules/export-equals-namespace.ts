// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 9
// CHECK-LABEL: function {{*}}name="see"

// FILE: main.ts
// `import * as ns` of a file that says `export = value`: the namespace has `default` and what the value has of its own, as of a CommonJS module.
import * as Class from "./class.cts";
import * as Function from "./function.cts";
import * as Obj from "./object.cts";
import * as Enum from "./enum.cts";
import * as Namespace from "./namespace.cts";
import * as Number from "./number.cts";
import * as Text from "./text.cts";
import * as ClassInTs from "./class-in-ts";
const see = (what: string, ns: any) => console.log(what, typeof ns, Object.keys(ns).join(), typeof ns.default, Object.prototype.toString.call(ns), "module.exports" in ns);
see("a class", Class);
see("a function", Function);
see("an object", Obj);
see("an enum", Enum);
see("a namespace", Namespace);
see("a number", Number);
see("a class in a .ts file", ClassInTs);
console.log("read as they are typed", Obj.a, Obj.b(), Enum.A, Namespace.x, Namespace.y(), Function.extra);
console.log("read through any", (Class as any).s, typeof (Class as any).make, "s" in Class, (Enum as any)[2], (ClassInTs as any).t, (Class as any).none);
console.log("default", new (Class as any).default().v, (Class as any).default.make() instanceof (Class as any).default, (Number as any).default, (Text as any).default);
const { a, b } = Obj;
console.log("taken apart", a, b());
console.log("import()", Object.keys(await import("./class.cts")).join(), (await import("./class.cts")) === (Class as any));

// FILE: class-in-ts.ts
class T { static t = "t"; }
export = T;

// FILE: class.cts
class Old { v = 7; static s = "s"; static make() { return new Old(); } }
export = Old;

// FILE: enum.cts
enum E { A = 1, B }
export = E;

// FILE: function.cts
function f() { return 1; }
namespace f { export const extra = "e"; }
export = f;

// FILE: namespace.cts
namespace N { export const x = 1; export function y() { return 2; } }
export = N;

// FILE: number.cts
const five = 5;
export = five;

// FILE: object.cts
const o = { a: 1, b() { return 2; } };
export = o;

// FILE: text.cts
const text: string = ["a", "b"].join("");
export = text;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
