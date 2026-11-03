// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
// A function that is specialized for integer arguments is also called with doubles, strings and other values.
import "./impl.js";

// FILE: impl.js
function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

(function () {
    function callsMappedWithIntegers(callee) {
        let sum = 0;
        try {
            for (let i = 0; i < 100; i++)
                sum += callee(i);
        } catch { }
        return sum;
    }
    function maps(array) {
        const mapped = function (x) { try { return x + 1; } catch { return 0; } };
        return callsMappedWithIntegers(mapped) + " " + array.map(mapped).join();
    }
    check(maps([1, 2, 3]), "5050 2,3,4", "integers are mapped");
    check(maps([1.5, 2.5]), "5050 2.5,3.5", "doubles are mapped");
    check(maps(["a", "b"]), "5050 a1,b1", "strings are mapped");
    check(maps([{ }, undefined, null, true]), "5050 [object Object]1,NaN,1,2", "other values are mapped");

    function callsVisitorWithIntegers(callee) {
        let sum = 0;
        try {
            for (let i = 0; i < 100; i++)
                sum += callee(i);
        } catch { }
        return sum;
    }
    function visits(array) {
        const visitor = function (x) { try { return x + 1; } catch { return 0; } };
        array.forEach(visitor);
        return [callsVisitorWithIntegers(visitor), array.filter(visitor).join(), array.some(visitor), array.every(visitor), array.find(visitor), array.findIndex(visitor), array.findLast(visitor), array.findLastIndex(visitor), array.reduce(visitor), array.reduceRight(visitor), array.flatMap(visitor).join()].join(" ");
    }
    check(visits([1, 2, 3]), "5050 1,2,3 true true 1 0 3 2 3 5 2,3,4", "integers are visited");
    check(visits(["a", "b"]), "5050 a,b true true a 0 b 1 a1 b1 a1,b1", "strings are visited");
    check(visits([{ }, undefined, null, true]), "5050 [object Object],,true true false [object Object] 0 true 3 [object Object]111 4 [object Object]1,NaN,1,2", "other values are visited");

    function callsStoredWithIntegers(callee) {
        let sum = 0;
        try {
            for (let i = 0; i < 100; i++)
                sum += callee(i);
        } catch { }
        return sum;
    }
    function readsFromLiteral(value) {
        const stored = function (x) { try { return x + 1; } catch { return 0; } };
        return callsStoredWithIntegers(stored) + " " + ({ method: stored }).method(value);
    }
    check(readsFromLiteral(1), "5050 2", "an integer is passed to what a literal holds");
    check(readsFromLiteral(1.5), "5050 2.5", "a double is passed to what a literal holds");
    check(readsFromLiteral("a"), "5050 a1", "a string is passed to what a literal holds");
    check(readsFromLiteral({ }), "5050 [object Object]1", "an object is passed to what a literal holds");
    check(readsFromLiteral(undefined), "5050 NaN", "undefined is passed to what a literal holds");
    check(readsFromLiteral(), "5050 NaN", "nothing is passed to what a literal holds");

    function callsKeptWithIntegers(callee) {
        let sum = 0;
        try {
            for (let i = 0; i < 100; i++)
                sum += callee(i);
        } catch { }
        return sum;
    }
    function callsMethodOf(object, value) { return object.method(value); }
    function keepsInObjects(value) {
        const kept = function (x) { try { return x + 1; } catch { return 0; } };
        return callsKeptWithIntegers(kept) + " " + callsMethodOf({ method: kept }, value) + " " + [kept][0](value);
    }
    check(keepsInObjects(1), "5050 2 2", "an integer is passed to what objects hold");
    check(keepsInObjects("a"), "5050 a1 a1", "a string is passed to what objects hold");
    check(keepsInObjects({ }), "5050 [object Object]1 [object Object]1", "an object is passed to what objects hold");
    check(keepsInObjects(undefined), "5050 NaN NaN", "undefined is passed to what objects hold");

    function callsCountedWithIntegers(callee) {
        let sum = 0;
        try {
            for (let i = 0; i < 100; i++)
                sum += callee(i, i);
        } catch { }
        return sum;
    }
    function passesTooFew(array) {
        const counted = function (x, y) { try { return x + y; } catch { return 0; } };
        return callsCountedWithIntegers(counted) + " " + ({ method: counted }).method(1) + " " + array.map(counted).join();
    }
    check(passesTooFew([5, 6]), "9900 NaN 5,7", "a missing argument is undefined");
    check(passesTooFew(["a"]), "9900 NaN a0", "a missing argument is undefined beside a string");
})();
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
