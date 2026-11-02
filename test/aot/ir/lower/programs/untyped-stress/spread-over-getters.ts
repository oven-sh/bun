// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
// Object spread over getters copies the value that the getter returns.
import "./impl.js";

// FILE: impl.js
function check(actual, expected, what)
{
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

function manyProperties()
{
    const object = { };
    for (let i = 0; i < 300; ++i)
        object["key" + i] = i;
    return object;
}
const dictionary = manyProperties();
const symbol = Symbol("s");

const cases = [
    ["a plain object", () => ({ x: 1, ...{ a: 1, b: 2 } }), "x,a,b"],
    ["two objects", () => ({ ...{ a: 1 }, ...{ b: 2 } }), "a,b"],
    ["a name that the target has", () => ({ a: 0, ...{ a: 1 } }), "a"],
    ["a property that is not enumerable", () => ({ x: 1, ...Object.defineProperty({ a: 1 }, "hidden", { value: 2, enumerable: false }) }), "x,a"],
    ["a symbol", () => ({ x: 1, ...{ [symbol]: 1, a: 2 } }), "x,a,Symbol(s)"],
    ["the rest of an object", () => { const { a, ...others } = { a: 1, b: 2, c: 3 }; return others; }, "b,c"],
    ["null", () => ({ x: 1, ...null }), "x"],
    ["undefined", () => ({ x: 1, ...undefined }), "x"],
    ["a string", () => ({ x: 1, ..."ab" }), "0,1,x"],
    ["a number", () => ({ x: 1, ...5 }), "x"],
    ["an array", () => ({ x: 1, ...[1, 2] }), "0,1,x"],
    ["a getter", () => ({ x: 1, ...{ get a() { return 1; } } }), "x,a"],
    ["a proxy", () => ({ x: 1, ...new Proxy({ a: 1 }, { }) }), "x,a"],
    ["a function", () => ({ x: 1, ...function () { } }), "x"],
    ["a getter of the target", () => ({ get a() { return 0; }, ...{ a: 1 } }), "a"],
    ["a dictionary", () => Object.keys({ x: 1, ...dictionary }).length, 301],
    ["an object after a dictionary", () => Object.keys({ x: 1, ...dictionary, ...{ a: 1 } }).length, 302],
];

for (const [what, run, expected] of cases) {
    for (let round = 0; round < 3; ++round) {
        const result = run();
        check(typeof result === "number" ? result : Reflect.ownKeys(result).map(String).join(), expected, what);
    }
}
check(({ get a() { return 0; }, ...{ a: 1 } }).a, 1, "the value that replaces a getter");
check(({ x: 1, ...{ get a() { return 7; } } }).a, 7, "the value of a getter");
console.log("passed");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
