// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
// Getters that call themselves until the stack overflows, and getters that catch that error.
import "./impl.js";

// FILE: impl.js
function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
const forever = 100000000;
let left = 0;
function outcomeOf(f) {
    try {
        return "returned " + f();
    } catch (error) {
        return error instanceof RangeError ? "RangeError" : "threw " + error;
    }
}
function exercise(what, f, expectedWhenShallow) {
    for (let i = 0; i < 20000; ++i) {
        left = 3;
        check(f(), expectedWhenShallow, what + " that returns");
    }
    for (let round = 0; round < 3; ++round) {
        left = forever;
        check(outcomeOf(f), "RangeError", what + " that does not return");
        left = 3;
        check(f(), expectedWhenShallow, what + " after the stack has overflowed");
    }
}

const literal = {
    get x() {
        if (left-- <= 0)
            return 0;
        return this.x + 1;
    }
};
exercise("a getter of an object literal", () => literal.x, 3);

class WithGetter {
    get x() {
        if (left-- <= 0)
            return 0;
        return this.x + 1;
    }
}
const withGetter = new WithGetter();
exercise("a getter of a class", () => withGetter.x, 3);

const key = Object.keys({ prop: 1 })[0];
class WithComputedRead {
    get prop() {
        if (left-- <= 0)
            return 0;
        return this[key] + 1;
    }
}
const withComputedRead = new WithComputedRead();
exercise("a getter that reads by value", () => withComputedRead[key], 3);
exercise("a getter that reads by value, read by name", () => withComputedRead.prop, 3);

class WithoutCondition { get prop() { return this[key]; } }
check(outcomeOf(() => new WithoutCondition().prop), "RangeError", "a getter that reads by value and was never called before");
check(outcomeOf(() => new WithoutCondition().prop), "RangeError", "a getter that reads by value, again");

class WithLength {
    get length() {
        if (left-- <= 0)
            return 0;
        return this.length + 1;
    }
}
const withLength = new WithLength();
exercise("a getter called length", () => withLength.length, 3);

class Mutual {
    get first() {
        if (left-- <= 0)
            return 0;
        return this.second + 1;
    }
    get second() {
        if (left-- <= 0)
            return 0;
        return this.first + 1;
    }
}
const mutual = new Mutual();
exercise("two getters that read each other", () => mutual.first, 3);

const one = { get other() { return left-- <= 0 ? 0 : two.other + 1; } };
const two = { get other() { return left-- <= 0 ? 0 : one.other + 1; } };
exercise("getters of two objects that read each other", () => one.other, 3);

let depth = 0;
class WithSetter {
    set x(value) {
        depth = value;
        if (left-- > 0)
            this.x = value + 1;
    }
}
const withSetter = new WithSetter();
exercise("a setter of a class", () => { withSetter.x = 0; return depth; }, 3);

class MutualSetters {
    set first(value) {
        depth = value;
        if (left-- > 0)
            this.second = value + 1;
    }
    set second(value) {
        depth = value;
        if (left-- > 0)
            this.first = value + 1;
    }
}
const mutualSetters = new MutualSetters();
exercise("two setters that store to each other", () => { mutualSetters.first = 0; return depth; }, 3);

class GetterAndSetter {
    get x() {
        if (left-- <= 0)
            return 0;
        this.x = 1;
        return depth + 1;
    }
    set x(value) {
        depth = this.x;
    }
}
const getterAndSetter = new GetterAndSetter();
exercise("a getter and a setter that use each other", () => getterAndSetter.x, 3);

class CatchesInside {
    get x() {
        try {
            return this.x + 1;
        } catch (error) {
            if (!(error instanceof RangeError))
                throw error;
            return 0;
        }
    }
}
const catchesInside = new CatchesInside();
for (let round = 0; round < 3; ++round)
    check(catchesInside.x > 100, true, "a getter that catches the error where the stack overflows");

class Derived extends WithGetter { }
const derived = new Derived();
exercise("an inherited getter", () => derived.x, 3);
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
