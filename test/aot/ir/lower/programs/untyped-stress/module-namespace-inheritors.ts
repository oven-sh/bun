// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
// Objects that inherit from a module namespace object.
import "./impl.js";

// FILE: impl.js
import * as self from "./impl.js";
function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function repeat(f, ...args) {
    let result;
    for (let i = 0; i < 100; i++)
        result = f(...args);
    return result;
}
export let value = "exported";
export let length = "exported length";
export function set(to) { value = to; }

function readFromNamespace(x) { return x.value; }
check(repeat(readFromNamespace, self), "exported", "the namespace object itself");
set("changed");
check(readFromNamespace(self), "changed", "the namespace object itself, after an assignment");
set("exported");

function readThroughTwo(x) { return x.value; }
const middle = Object.create(self);
const bottom = Object.create(middle);
check(repeat(readThroughTwo, bottom), "exported", "an object that inherits from an object that inherits from the namespace object");
set("changed");
check(readThroughTwo(bottom), "changed", "the binding is read each time");
set("exported");
Object.defineProperty(middle, "value", { value: "shadowed", configurable: true });
check(readThroughTwo(bottom), "shadowed", "the object in between got the property");
delete middle.value;
check(readThroughTwo(bottom), "exported", "and lost it");
Object.setPrototypeOf(middle, { value: "another prototype" });
check(readThroughTwo(bottom), "another prototype", "the object in between got another prototype");

function readThroughOne(x) { return x.value; }
const child = Object.create(self);
check(repeat(readThroughOne, child), "exported", "an object that inherits from the namespace object");
check(readThroughOne(Object.create(self)), "exported", "another one of the same shape");
Object.defineProperty(child, "value", { value: "own" });
check(readThroughOne(child), "own", "it got the property itself");

function readFromDictionary(x) { return x.value; }
const dictionary = Object.create(self);
for (let round = 0; round < 2; round++) {
    for (let i = 0; i < 300; i++)
        Object.defineProperty(dictionary, "property" + round + "_" + i, { value: i, configurable: true });
    check(repeat(readFromDictionary, dictionary), "exported", "a dictionary that inherits from the namespace object");
}
Object.defineProperty(dictionary, "value", { value: "own" });
check(readFromDictionary(dictionary), "own", "the dictionary got the property, its structure is the same");

const grandparent = Object.create(self);
const parent = Object.create(grandparent);
const home = { __proto__: parent, read() { return super.value; } };
check(repeat(() => home.read()), "exported", "a read from super");
Object.defineProperty(grandparent, "value", { value: "shadowed" });
check(home.read(), "shadowed", "a read from super, after an object further up got the property");

const builtinsAreFixed = !Object.isExtensible(Object.prototype);
function readFromNumber(x) { return x.value; }
function readLengthOfNumber(x) { return x.length; }
function readFromBoolean(x) { return x.value; }
function readFromString(x) { return x.value; }
function readFromSymbol(x) { return x.value; }
for (const [read, primitive, prototype] of [[readFromNumber, 5, Number.prototype], [readFromNumber, 1.5, Number.prototype], [readLengthOfNumber, 5, Number.prototype], [readFromBoolean, true, Boolean.prototype], [readFromString, "s", String.prototype], [readFromSymbol, Symbol.iterator, Symbol.prototype]]) {
    const expected = read === readLengthOfNumber ? "exported length" : "exported";
    if (builtinsAreFixed) {
        check(Reflect.setPrototypeOf(prototype, self), false, "whether the prototype of a " + typeof primitive + " can inherit from the namespace object");
        check(repeat(read, primitive), undefined, "a " + typeof primitive + " that cannot inherit from the namespace object");
        continue;
    }
    Object.setPrototypeOf(prototype, self);
    const inherited = repeat(read, primitive);
    Object.setPrototypeOf(prototype, Object.prototype);
    check(inherited, expected, "a " + typeof primitive + " that inherits from the namespace object");
    check(read(primitive), undefined, "a " + typeof primitive + " that no longer does");
}
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
