class A {
    name(): string {
        return "A";
    }
}
class B extends A {
    override name(): string {
        return "B";
    }
}
class C extends B {
    override name(): string {
        return "C";
    }
}
class L {
    name(): string {
        return "L";
    }
}

function answers(value: unknown): string {
    let found = "";
    if (value instanceof A) found += "A";
    if (value instanceof B) found += "B";
    if (value instanceof C) found += "C";
    if (value instanceof L) found += "L";
    return found === "" ? "none" : found;
}

function asBooleans(value: unknown): boolean[] {
    return [value instanceof A, value instanceof B, value instanceof C, value instanceof L];
}

function createValues(): [string, unknown][] {
    return [
        ["new A", new A()],
        ["new B", new B()],
        ["new C", new C()],
        ["new L", new L()],
        ["B with the prototype of L", Object.setPrototypeOf(new B(), L.prototype)],
        ["L with the prototype of C", Object.setPrototypeOf(new L(), C.prototype)],
        ["Object.create(A.prototype)", Object.create(A.prototype)],
        ["Object.create(C.prototype)", Object.create(C.prototype)],
        ["Object.create(null)", Object.create(null)],
        ["proxy of B", new Proxy(new B(), {})],
        ["proxy that answers L", new Proxy(new B(), { getPrototypeOf: () => L.prototype })],
        ["plain object", {}],
        ["function", function () {}],
        ["array", []],
        ["number", 1],
        ["double", 1.5],
        ["string", "A"],
        ["boolean", true],
        ["symbol", Symbol("A")],
        ["bigint", 1n],
        ["undefined", undefined],
        ["null", null],
    ];
}

function report(title: string): void {
    console.log(title);
    const values = createValues();
    for (const [label, value] of values) console.log(label, answers(value), asBooleans(value).join());

    const counts = new Map<string, number>();
    for (let round = 0; round < 20000; round++) {
        const [label, value] = values[round % values.length];
        if (answers(value) !== "none") counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    for (const [label, count] of counts) console.log(label, count);
}

report("by layout");

Object.defineProperty(A, Symbol.hasInstance, { value: (value: unknown) => value === "A" });
report("A answers for itself");

Object.defineProperty(L, Symbol.hasInstance, { value: () => true });
report("L answers yes");
