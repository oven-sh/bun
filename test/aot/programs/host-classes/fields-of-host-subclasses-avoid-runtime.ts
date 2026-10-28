// A class field of a class that extends a host class is defined by a stub from the second instance on. The program counts the entries of the operation that the stub leaves for.
declare const aotOperationCount: undefined | ((name: string) => number);
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
function entered(): number { return counted ? counted("operationAOTPutByIdAndCache") : 0; }
const lines: string[] = [];

class OfPromise extends Promise<void> { first = 1; second = "two"; }
class OfPromiseWithFiveFields extends Promise<void> { first = 1; second = 2; third = 3; fourth = 4; fifth = 5; }
class OfMap extends Map<string, number> { first = 1; second = "two"; }
class OfSet extends Set<number> { first = 1; second = "two"; }
class OfWeakMap extends WeakMap<object, number> { first = 1; second = "two"; }
class OfWeakSet extends WeakSet<object> { first = 1; second = "two"; }
class OfDate extends Date { first = 1; second = "two"; }
class OfArrayBuffer extends ArrayBuffer { first = 1; second = "two"; }
class OfDataView extends DataView<ArrayBuffer> { first = 1; second = "two"; }
class OfError extends Error { first = 1; second = "two"; }
class OfTypeError extends TypeError { first = 1; second = "two"; }
class OfOfMap extends OfMap { third = 3; }

function measure(name: string, make: () => { first: number }): void {
    const turns = 2000;
    let total = 0;
    const before = entered();
    for (let turn = 0; turn < turns; turn++) total += make().first;
    const entries = entered() - before;
    lines.push(`${name}: ${total} instances, ${entries < 40 ? "few entries" : entries + " entries"}`);
}

const executor = () => {};
const buffer = new ArrayBuffer(8);
measure("Promise", () => new OfPromise(executor));
measure("Promise, five fields", () => new OfPromiseWithFiveFields(executor));
measure("Map", () => new OfMap());
measure("Set", () => new OfSet());
measure("WeakMap", () => new OfWeakMap());
measure("WeakSet", () => new OfWeakSet());
measure("Date", () => new OfDate(0));
measure("ArrayBuffer", () => new OfArrayBuffer(8));
measure("DataView", () => new OfDataView(buffer));
measure("Error", () => new OfError("message"));
measure("TypeError", () => new OfTypeError("message"));
measure("a subclass of a subclass of Map", () => new OfOfMap());
console.log(lines.join("\n"));
