// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
// Calls and `new` on values that are not callable, at module level: arguments are evaluated first, and `finally` blocks run.
import "./impl.js";

// FILE: impl.js
function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
const object = { number: 5, nothing: undefined, text: "text" };
let variable = 1;
let caught = [];
let ranFinally = 0;

try { object.missing(1); caught.push("none"); } catch (error) { caught.push(error instanceof TypeError); }
try { object.missing(); caught.push("none"); } catch (error) { caught.push(error instanceof TypeError); }
try { object.number(1, 2); caught.push("none"); } catch (error) { caught.push(error instanceof TypeError); }
try { object.text(); caught.push("none"); } catch (error) { caught.push(error instanceof TypeError); }
try { object.missing(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12); caught.push("none"); } catch (error) { caught.push(error instanceof TypeError); }
try { object.missing(...[1, 2]); caught.push("none"); } catch (error) { caught.push(error instanceof TypeError); }
try { object.missing`text`; caught.push("none"); } catch (error) { caught.push(error instanceof TypeError); }
try { (void 0)(); caught.push("none"); } catch (error) { caught.push(error instanceof TypeError); }
try { let callee = object.nothing; callee(1); caught.push("none"); } catch (error) { caught.push(error instanceof TypeError); }
try { new object.missing(); caught.push("none"); } catch (error) { caught.push(error instanceof TypeError); }
try { new object.number(1); caught.push("none"); } catch (error) { caught.push(error instanceof TypeError); }
try { new object.missing(...[1]); caught.push("none"); } catch (error) { caught.push(error instanceof TypeError); }
try { new (() => 1)(); caught.push("none"); } catch (error) { caught.push(error instanceof TypeError); }
try { ({}).toString.missing.call(1); caught.push("none"); } catch (error) { caught.push(error instanceof TypeError); }
check(caught.join(), new Array(14).fill(true).join(), "calls and constructions of what is not callable");

check(object.missing?.(1), undefined, "an optional call of nothing");
let order = [];
try { object.missing(order.push("first"), order.push("second")); } catch (error) { order.push(error.constructor.name); } finally { ++ranFinally; }
check(order.join(), "first,second,TypeError", "the arguments are evaluated before the call fails");
check(ranFinally, 1, "the finally block");

let count = 0;
for (let i = 0; i < 100; ++i) {
    try {
        (i & 1 ? object.missing : Math.abs)(-i);
        ++count;
    } catch (error) {
        count += error instanceof TypeError ? 1000 : 0;
    }
}
check(count, 50050, "failing calls in a loop");

try {
    try { object.missing(); } finally { ++ranFinally; }
} catch (error) {
    check(error instanceof TypeError, true, "an error that passes a finally block");
}
check(ranFinally, 2, "the inner finally block");

let stack;
try { object.missing(); } catch (error) { stack = error.stack; }
check(typeof stack, "string", "the stack of the error");
check(stack.includes("impl.js"), true, "the stack names the module");

const plainProxy = new Proxy(function (a, b) { return a + b; }, { });
const trappingProxy = new Proxy(function () { }, {
    apply(target, receiver, list) { return "applied " + list.join(); },
    construct(target, list, newTarget) { return { text: "constructed " + list.join(), isNewTarget: newTarget === trappingProxy }; },
});
const classProxy = new Proxy(class { constructor(value) { this.value = value; } }, { });
const throwingProxy = new Proxy(function () { }, { apply() { throw new RangeError("trap"); }, construct() { throw new RangeError("trap"); } });
check(plainProxy(1, 2), 3, "a call of a proxy");
check(plainProxy(...[3, 4]), 7, "a call of a proxy with spread arguments");
check(trappingProxy(1, 2, 3), "applied 1,2,3", "a call of a proxy with a trap");
check(trappingProxy(), "applied ", "a call of a proxy without arguments");
check(trappingProxy(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12), "applied 1,2,3,4,5,6,7,8,9,10,11,12", "a call of a proxy with many arguments");
check(new trappingProxy(4, 5).text, "constructed 4,5", "a construction of a proxy with a trap");
check(new trappingProxy().isNewTarget, true, "new.target of a construction of a proxy");
check(new classProxy(6).value, 6, "a construction of a proxy of a class");
check({ method: trappingProxy }.method(7), "applied 7", "a proxy called as a method");
caught = [];
try { throwingProxy(); } catch (error) { caught.push(error instanceof RangeError); }
try { new throwingProxy(); } catch (error) { caught.push(error instanceof RangeError); }
try { classProxy(); } catch (error) { caught.push(error instanceof TypeError); }
try { new (new Proxy(() => 1, { }))(); } catch (error) { caught.push(error instanceof TypeError); }
check(caught.join(), "true,true,true,true", "proxies that throw");
let total = 0;
for (let i = 0; i < 100; ++i)
    total += plainProxy(i, 1) + new classProxy(i).value;
check(total, 10000, "proxies in a loop");

check(eval("1 + 1"), 2, "direct eval");
check(eval("variable + object.number"), 6, "direct eval reads the variables of the module");
eval("variable = 7");
check(variable, 7, "direct eval assigns to a variable of the module");
check(eval("var local = 3; local + variable"), 10, "direct eval with a variable of its own");
check(typeof local, "undefined", "which stays inside");
check(eval("this"), undefined, "this in direct eval");
check(eval("(() => variable * 2)")(), 14, "a closure made by direct eval");
let evalError;
try { eval("object.missing()"); } catch (error) { evalError = error; }
check(evalError instanceof TypeError, true, "a failing call in direct eval");
try { eval("("); } catch (error) { evalError = error; }
check(evalError instanceof SyntaxError, true, "a syntax error in direct eval");
for (let i = 0; i < 20; ++i)
    check(eval("variable + " + i), 7 + i, "direct eval in a loop");

await 0;
caught = "none";
try { object.missing(1); } catch (error) { caught = error instanceof TypeError; }
check(caught, true, "a failing call after await");
check(eval("variable"), 7, "direct eval after await");
check(plainProxy(5, 6), 11, "a call of a proxy after await");

function inFunction() { try { object.missing(1); } catch (error) { return error instanceof TypeError; } }
check(inFunction(), true, "a failing call in a function");
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
