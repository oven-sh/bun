// The allocation of a literal lists the fields that are defined behind its head. A value that the slot of its field may not admit is left to the run time, behind the allocation, with something in its place.
// Nothing of that shows: the order of the keys, the values, the descriptors, the prototype, and no setter of the prototype runs for a definition.
type Row = { first: number; second: number; third: string; fourth: boolean; fifth?: number };
type Holder = { first: number; held: Row; last: number };
type Summed = { sum(): number; first: number; second: number; third: string; fourth: boolean; fifth?: number };
type HolderWithMethod = { name(): string; first: number; held: Row; last: number };

const lines: string[] = [];
const prototype = {
    inherited: "yes",
    set second(value: number) { lines.push("a setter ran for a definition"); },
    set third(value: string) { lines.push("a setter ran for a definition"); },
};

function show(value: unknown): string {
    if (typeof value === "bigint") return value + "n";
    if (typeof value === "symbol") return value.toString();
    if (typeof value === "function") return "function " + value.name;
    if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
    if (typeof value === "object" && value) return "{" + Object.keys(value).join() + "}";
    return typeof value + ":" + String(value);
}

function describe(object: object): string {
    const parts: string[] = [];
    for (const key of Reflect.ownKeys(object)) {
        const descriptor = Object.getOwnPropertyDescriptor(object, key)!;
        parts.push(String(key) + "=" + show(descriptor.value) + (descriptor.writable ? "w" : "") + (descriptor.enumerable ? "e" : "") + (descriptor.configurable ? "c" : ""));
    }
    let forIn = "";
    for (const key in object) forIn += key + ",";
    return parts.join(" ") + " | " + forIn + " | " + JSON.stringify(object, (key, value) => typeof value === "bigint" ? "big" : value) + " | " + (Object.getPrototypeOf(object) === prototype ? "the prototype" : Object.getPrototypeOf(object) === Object.prototype ? "Object.prototype" : "another");
}

function belowAnotherPrototype(a: any, b: any, c: any, d: any): Row {
    return { __proto__: prototype, first: a, second: b, third: c, fourth: d } as any;
}
function behindMethod(a: any, b: any, c: any, d: any): Row {
    return { sum() { return (this as any).first + (this as any).second; }, first: a, second: b, third: c, fourth: d } as any;
}
// The parameters say what the caller promises. A caller without types keeps no promise, and nothing throws because of a type.
function typedBehindMethod(a: number, b: number, c: string, d: boolean): Summed {
    return { sum() { return this.first + this.second; }, first: a, second: b, third: c, fourth: d };
}
function typedBehindMethodWithOptional(a: number, b: number, c: string, d: boolean): Summed {
    return { sum() { return this.first + this.second; }, first: a, second: b, third: c, fourth: d, fifth: a };
}
function typedHolderBehindMethod(a: number, b: number, c: string, d: boolean): HolderWithMethod {
    return { name() { return "holder"; }, first: a, held: b as unknown as Row, last: a };
}
function typedStoredOneByOne(a: number, b: number, c: string, d: boolean): Row {
    const row = {} as Row;
    row.first = a;
    row.second = b;
    row.third = c;
    row.fourth = d;
    return row;
}
// What is read from a value without a type is handed to fields that have one.
function fromValuesWithoutType(a: any, b: any, c: any, d: any): Summed {
    const source: any = { a, b, c, d };
    return { sum() { return this.first + this.second; }, first: source.a, second: source.b, third: source.c, fourth: source.d };
}
function fromValuesWithoutTypeBetweenOthers(a: any, b: any, c: any, d: any): Summed {
    const source: any = { a, b, c, d };
    return { sum() { return this.first + this.second; }, first: 1, second: source.b, third: "three", fourth: source.d, fifth: 5 };
}
function holderFromValuesWithoutType(a: any, b: any, c: any, d: any): HolderWithMethod {
    const source: any = { a, b, c, d };
    return { name() { return "holder"; }, first: source.a, held: source.b, last: 9 };
}
function storedOneByOneFromValuesWithoutType(a: any, b: any, c: any, d: any): Row {
    const source: any = { a, b, c, d };
    const row = {} as Row;
    row.first = source.a;
    row.second = 2;
    row.third = source.c;
    row.fourth = true;
    return row;
}
function storedOneByOne(a: any, b: any, c: any, d: any): Row {
    const row = {} as Row;
    row.first = a;
    row.second = b;
    row.third = c;
    row.fourth = d;
    return row;
}
function withOptionalLast(a: any, b: any, e: any): Row {
    return { __proto__: null, first: a, second: b, third: "t", fourth: true, fifth: e } as any;
}
function holder(a: any, held: any, z: any): Holder {
    return { __proto__: null, first: a, held, last: z } as any;
}
function calledInBetween(a: any, b: any): Row {
    return { __proto__: prototype, first: a, second: note(b), third: String(note("third")), fourth: !!note(true) } as any;
}
function note<T>(value: T): T { lines.push("evaluated " + show(value)); return value; }
function throwsInBetween(a: any): Row {
    return { __proto__: prototype, first: a, second: thrower(), third: "never", fourth: true } as any;
}
function thrower(): number { throw new Error("thrown in the literal"); }

const others: unknown[] = [1, 1.5, -0, NaN, 2 ** 31, 2 ** 53, "text", "", true, false, undefined, null, 10n, Symbol("s"), { inner: 1 }, [1, 2], function named() { }];
const makers: ((a: any, b: any, c: any, d: any) => object)[] = [belowAnotherPrototype, behindMethod, storedOneByOne, typedBehindMethod, typedBehindMethodWithOptional, typedHolderBehindMethod, typedStoredOneByOne,
    fromValuesWithoutType, fromValuesWithoutTypeBetweenOthers, holderFromValuesWithoutType, storedOneByOneFromValuesWithoutType];
for (let round = 0; round < 3; round++) {
    for (const maker of makers) {
        for (const other of others) {
            lines.push(maker.name + " 1 " + describe(maker(other, 2, "three", true)));
            lines.push(maker.name + " 2 " + describe(maker(1, other, "three", true)));
            lines.push(maker.name + " 3 " + describe(maker(1, 2, other, true)));
            lines.push(maker.name + " 4 " + describe(maker(1, 2, "three", other)));
            lines.push(maker.name + " all " + describe(maker(other, other, other, other)));
        }
    }
    for (const other of others) {
        lines.push("optional " + describe(withOptionalLast(1, other, other)));
        lines.push("holder " + describe(holder(other, other, other)));
        lines.push("holder of a row " + describe(holder(1, belowAnotherPrototype(1, other, "t", false), other)));
        lines.push("in between " + describe(calledInBetween(other, other)));
    }
    try { throwsInBetween(1); } catch (error) { lines.push((error as Error).message); }
}

const atTopLevel: any = { __proto__: prototype, first: others[6], second: others[10], third: others[0], fourth: others[14] };
lines.push("top level " + describe(atTopLevel));
atTopLevel.second = 5;
lines.push("top level, stored again " + describe(atTopLevel));
delete atTopLevel.second;
atTopLevel.second = 6;
lines.push("top level, deleted and stored " + describe(atTopLevel) + " " + lines.filter(line => line.startsWith("a setter ran")).length);
const frozen = Object.freeze(belowAnotherPrototype(1, "two", 3, 4));
lines.push("frozen " + describe(frozen) + " " + Object.isFrozen(frozen));

let hash = 0;
for (const line of lines) for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0;
console.log(lines.length, hash);
console.log(lines.slice(0, 40).join("\n"));
console.log(lines.slice(-12).join("\n"));
