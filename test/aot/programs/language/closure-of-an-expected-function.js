// A call whose callee is expected to be a closure of one function tests for it. Every kind of value goes through the test:
// closures of the function as created, with properties, with another prototype, frozen; closures of other functions; what is no closure; what is no cell.
function makeAdder(amount) {
    return function add(value) {
        return value + amount;
    };
}
function makeOther(amount) {
    return function subtract(value) {
        return value - amount;
    };
}
function makeAsync(amount) {
    return async function addLater(value) {
        return value + amount;
    };
}

function describe(result) {
    if (result instanceof Promise)
        return "promise";
    return typeof result + " " + String(result);
}

function callIt(callee, value) {
    try {
        return describe(callee(value));
    } catch (error) {
        return error.constructor.name;
    }
}

function callOften(callee) {
    let sum = 0;
    for (let i = 0; i < 2000; i++)
        sum += callee(i);
    return sum;
}

const withProperty = makeAdder(2);
withProperty.label = "two";
const withManyProperties = makeAdder(3);
for (let i = 0; i < 12; i++)
    withManyProperties["key" + i] = i;
const withPrototype = makeAdder(4);
Object.setPrototypeOf(withPrototype, { inherited: true });
const frozen = Object.freeze(makeAdder(5));
const named = makeAdder(6);
Object.defineProperty(named, "name", { value: "renamed" });
const otherWithProperty = makeOther(7);
otherWithProperty.label = "seven";

class Callable {
    static call(value) {
        return value;
    }
}

const callees = [
    makeAdder(1), withProperty, withManyProperties, withPrototype, frozen, named,
    makeOther(1), otherWithProperty, makeAsync(1),
    makeAdder(8).bind(null), value => value * 2, Math.abs, parseInt, Callable, Callable.call,
    new Proxy(makeAdder(9), {}), function* generate(value) { yield value; },
    undefined, null, true, false, 0, -0, 1.5, NaN, 12345678901234, 10n, "text", "", Symbol.iterator,
    {}, [], /x/, new Date(0), new Map(), Object.create(null), { call() {} },
];

for (let round = 0; round < 3; round++) {
    for (const callee of callees)
        console.log(round, callIt(callee, 10));
}
console.log(callOften(makeAdder(1)), callOften(withProperty), callOften(makeOther(1)), callOften(frozen));
console.log(withProperty.label, withManyProperties.key11, withPrototype.inherited, named.name, otherWithProperty.label);
