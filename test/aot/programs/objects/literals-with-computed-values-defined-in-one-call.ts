// Object literals under a dictionary type whose values are computed, so that no constant data stands for them: 3 to 40 keys, made once at module level and again and again in loops. Key order, descriptors, names written twice, index keys, `__proto__`, accessors and read-only properties above the object, members beside the fields of a layout, and what later changes do.
// STATISTIC: PropertyRunGroups >= 1
const out: string[] = [];
function say(what: string, ...parts: unknown[]): void { out.push(what + ": " + parts.join(" ")); }
function show(o: object): string { return Object.keys(o).join(",") + " | " + JSON.stringify(o); }
function describe(o: object): string {
    const parts: string[] = [];
    for (const key of Reflect.ownKeys(o)) {
        const found = Object.getOwnPropertyDescriptor(o, key)!;
        const flags = (found.writable ? "w" : "-") + (found.enumerable ? "e" : "-") + (found.configurable ? "c" : "-");
        parts.push(String(key) + "=" + ("value" in found ? String(found.value) : "accessor") + "/" + flags);
    }
    return parts.join(" ");
}
function checksum(o: Record<string, number>): number {
    let sum = 0;
    for (const key in o) sum = (sum * 31 + o[key] + key.length) % 1000003;
    return sum;
}
const steps: string[] = [];
function step(name: string, value: number): number { steps.push(name); return value; }

let setterCalls = 0;
const parent = Object.freeze({
    get watched(): unknown { return "inherited"; },
    set watched(value: unknown) { setterCalls++; },
    fixed: "read-only",
});
// A compiled program refuses a new name on Object.prototype, and plain Bun takes it. A definition looks at neither, so both print the same.
function tryOnObjectPrototype(name: string, descriptor: PropertyDescriptor): void { try { Object.defineProperty(Object.prototype, name, descriptor); } catch { } }
function removeFromObjectPrototype(name: string): void { try { delete (Object.prototype as any)[name]; } catch { } }

interface Options { x: number; [name: string]: number }

// Once, at module level.
{
    const n: number = JSON.parse("3");
    const text: string = JSON.parse('"t"');

    const three: Record<string, number> = { one: n, two: n + 1, three: n + 2 };
    say("three keys", show(three), describe(three));

    const kinds: Record<string, unknown> = { number: n * 2, string: text, boolean: n > 2, nothing: undefined, none: null };
    say("values of every kind", show(kinds), describe(kinds));

    const seven: Record<string, number> = { a: n, b: n - 1, c: n * n, d: n / 2, e: n % 2, f: -n, g: n | 8 };
    say("seven keys", show(seven), checksum(seven));

    const sixteen: Record<string, number> = {
        p0: n, p1: n + 1, p2: n + 2, p3: n + 3, p4: n + 4, p5: n + 5, p6: n + 6, p7: n + 7, p8: n + 8, p9: n + 9,
        p10: n + 10, p11: n + 11, p12: n + 12, p13: n + 13, p14: n + 14, p15: n + 15,
    };
    say("sixteen keys", Object.keys(sixteen).length, checksum(sixteen), describe(sixteen));

    const seventeen: Record<string, number> = {
        q0: n, q1: n + 1, q2: n + 2, q3: n + 3, q4: n + 4, q5: n + 5, q6: n + 6, q7: n + 7, q8: n + 8, q9: n + 9,
        q10: n + 10, q11: n + 11, q12: n + 12, q13: n + 13, q14: n + 14, q15: n + 15, q16: n + 16,
    };
    say("seventeen keys", Object.keys(seventeen).join(), checksum(seventeen));

    const thirtyThree: Record<string, number> = {
        r0: n, r1: n + 1, r2: n + 2, r3: n + 3, r4: n + 4, r5: n + 5, r6: n + 6, r7: n + 7, r8: n + 8, r9: n + 9,
        r10: n + 10, r11: n + 11, r12: n + 12, r13: n + 13, r14: n + 14, r15: n + 15, r16: n + 16, r17: n + 17, r18: n + 18, r19: n + 19,
        r20: n + 20, r21: n + 21, r22: n + 22, r23: n + 23, r24: n + 24, r25: n + 25, r26: n + 26, r27: n + 27, r28: n + 28, r29: n + 29,
        r30: n + 30, r31: n + 31, r32: n + 32,
    };
    say("thirty-three keys", Object.keys(thirtyThree).join(), checksum(thirtyThree));

    const forty: Record<string, number> = {
        s0: n, s1: n + 1, s2: n + 2, s3: n + 3, s4: n + 4, s5: n + 5, s6: n + 6, s7: n + 7, s8: n + 8, s9: n + 9,
        s10: n + 10, s11: n + 11, s12: n + 12, s13: n + 13, s14: n + 14, s15: n + 15, s16: n + 16, s17: n + 17, s18: n + 18, s19: n + 19,
        s20: n + 20, s21: n + 21, s22: n + 22, s23: n + 23, s24: n + 24, s25: n + 25, s26: n + 26, s27: n + 27, s28: n + 28, s29: n + 29,
        s30: n + 30, s31: n + 31, s32: n + 32, s33: n + 33, s34: n + 34, s35: n + 35, s36: n + 36, s37: n + 37, s38: n + 38, s39: n + 39,
    };
    say("forty keys", Object.keys(forty).join(), checksum(forty), describe(forty).length);
    Bun.gc(true);
    say("forty keys after a collection", checksum(forty), forty.s0, forty.s16, forty.s39, forty.s40);

    const quoted: Record<string, number> = { "content-length": n, "x y": n + 1, "": n + 2, "é": n + 3 };
    say("names that are no identifiers", show(quoted), describe(quoted));

    const likeBuiltIns: Record<string, number> = { constructor: n, toString: n + 1, valueOf: n + 2, hasOwnProperty: n + 3, length: n + 4, then: n + 5, prototype: n + 6, name: n + 7 };
    say("names like those of built-ins", show(likeBuiltIns), Object.hasOwn(likeBuiltIns, "toString"), Object.getPrototypeOf(likeBuiltIns) === Object.prototype);

    const withIndexKeys: Record<string, number> = { x: n, y: n + 1, z: n + 2, 2: n + 3, u: n + 4, v: n + 5, w: n + 6, 1: n + 7 };
    say("index keys between", show(withIndexKeys), describe(withIndexKeys));

    const withOwnProto: Record<string, number> = { a: n, b: n + 1, c: n + 2, ["__proto__"]: n + 3, d: n + 4, e: n + 5, f: n + 6 };
    say("a computed __proto__ between", show(withOwnProto), Object.hasOwn(withOwnProto, "__proto__"), Object.getPrototypeOf(withOwnProto) === Object.prototype);

    const withComputedKey: Record<string, number> = { a: n, b: n + 1, c: n + 2, [text + "!"]: n + 3, d: n + 4, e: n + 5, f: n + 6 };
    say("a computed key between", show(withComputedKey));

    // @ts-ignore A name that is written twice is what the next line is for.
    const twice: Record<string, number> = { a: n, b: n + 1, a: n + 2, c: n + 3, d: n + 4 };
    say("a name written twice", show(twice), describe(twice));
    // @ts-ignore
    const allTwice: Record<string, number> = { a: n, b: n + 1, c: n + 2, a: n + 3, b: n + 4, c: n + 5 };
    say("every name written twice", show(allTwice), describe(allTwice));

    const withAccessor: Record<string, number> = { a: n, b: n + 1, c: n + 2, get d() { return n * 10; }, e: n + 4, f: n + 5, g: n + 6 };
    say("an accessor between", show(withAccessor), describe(withAccessor));
    // @ts-ignore
    const overAccessor: Record<string, number> = { get a() { return -1; }, b: n, a: n + 1, c: n + 2, d: n + 3 };
    say("a definition over an accessor", show(overAccessor), describe(overAccessor));

    const withSpread: Record<string, number> = { a: n, b: n + 1, c: n + 2, ...three, d: n + 3, e: n + 4, f: n + 5 };
    say("a spread between", show(withSpread));

    const called: Record<string, number> = { a: step("a", n), b: step("b", n + 1), c: n, d: n + 1, e: n + 2, f: step("f", n + 3), g: n + 4, h: n + 5, i: n + 6 };
    say("calls between", show(called), steps.join());

    const holders: Record<string, unknown> = { list: [n, n + 1], inner: { deep: n }, arrow: () => n, method() { return n + 1; }, plain: function () { return n + 2; } };
    say("values that are allocated", Object.keys(holders).join(), JSON.stringify(holders), (holders.arrow as Function).name, (holders.method as Function).name, (holders.plain as Function).name, (holders.arrow as () => number)() + (holders.method as () => number)() + (holders.plain as () => number)());

    const below: Record<string, unknown> = { __proto__: parent, before: n, watched: n + 1, fixed: n + 2, after: n + 3 };
    say("below a frozen prototype", show(below), describe(below), setterCalls, Object.getPrototypeOf(below) === parent);
    const belowNothing: Record<string, unknown> = { __proto__: null, before: n, watched: n + 1, fixed: n + 2, after: n + 3 };
    say("below no prototype", show(belowNothing), describe(belowNothing), Object.getPrototypeOf(belowNothing));
    const stored: any = Object.create(parent);
    stored.watched = n;
    let refused = "stored";
    try { stored.fixed = n; } catch (error) { refused = (error as Error).constructor.name; }
    say("stores below the same prototype", show(stored), setterCalls, refused);

    tryOnObjectPrototype("guarded", { get() { return "inherited"; }, set() { setterCalls += 100; }, configurable: true });
    tryOnObjectPrototype("constant", { value: "read-only", writable: false, configurable: true });
    const belowChanged: Record<string, number> = { first: n, guarded: n + 1, constant: n + 2, last: n + 3 };
    say("names that Object.prototype may intercept", show(belowChanged), describe(belowChanged), setterCalls);
    removeFromObjectPrototype("guarded");
    removeFromObjectPrototype("constant");

    const options: Options = { x: n, extraA: n + 1, extraB: n + 2, extraC: n + 3, extraD: n + 4 };
    say("members beside a field", show(options), describe(options));
    const fieldBetween: Options = { extraA: n, x: n + 1, extraB: n + 2, extraC: n + 3, extraD: n + 4 };
    say("a field between such members", show(fieldBetween), describe(fieldBetween));
    delete fieldBetween.extraB;
    fieldBetween.extraE = n + 5;
    fieldBetween.extraB = n + 6;
    say("changed afterwards", show(fieldBetween), fieldBetween.x, fieldBetween.extraB, fieldBetween.missing);

    delete seven.c;
    seven.h = n;
    seven.c = n + 1;
    Object.defineProperty(seven, "a", { enumerable: false });
    say("a dictionary changed afterwards", show(seven), describe(seven));
    Object.freeze(three);
    let frozen = "stored";
    try { three.one = 0; } catch (error) { frozen = (error as Error).constructor.name; }
    say("a dictionary frozen afterwards", show(three), describe(three), frozen);
}

// Again and again.
function four(a: number, b: number, c: string, d: boolean): Record<string, unknown> { return { first: a, second: b, third: c, fourth: d }; }
function six(n: number): Record<string, number> { return { a: n, b: n + 1, c: n + 2, d: n + 3, e: n + 4, f: n + 5 }; }
function twenty(n: number): Record<string, number> {
    return {
        t0: n, t1: n + 1, t2: n + 2, t3: n + 3, t4: n + 4, t5: n + 5, t6: n + 6, t7: n + 7, t8: n + 8, t9: n + 9,
        t10: n + 10, t11: n + 11, t12: n + 12, t13: n + 13, t14: n + 14, t15: n + 15, t16: n + 16, t17: n + 17, t18: n + 18, t19: n + 19,
    };
}
function under(prototype: object | null, n: number): Record<string, unknown> { return { __proto__: prototype, before: n, watched: n + 1, fixed: n + 2, after: n + 3 }; }
function withExtras(n: number): Options { return { x: n, extraA: n + 1, extraB: n + 2, extraC: n + 3, extraD: n + 4 }; }
// @ts-ignore
function repeated(n: number): Record<string, number> { return { a: n, b: n + 1, c: n + 2, a: n + 3, b: n + 4, c: n + 5 }; }
function seldom(n: number): Record<string, number> | undefined {
    if (n % 5000 === 4999) return { rare0: n, rare1: n + 1, rare2: n + 2, rare3: n + 3 };
    return undefined;
}

{
    let sum = 0;
    let keys = 0;
    for (let i = 0; i < 20000; i++) {
        const o = four(i, i * 2, "x", (i & 1) === 0);
        sum += (o.first as number) + (o.second as number) + (o.fourth ? 1 : 0);
        keys += Object.keys(o).length;
    }
    say("four keys in a loop", sum, keys, show(four(1, 2, "three", false)), describe(four(1, 2, "three", false)));

    sum = 0;
    for (let i = 0; i < 20000; i++) sum = (sum + checksum(six(i))) % 1000003;
    say("six keys in a loop", sum, show(six(7)));

    sum = 0;
    const kept: Record<string, number>[] = [];
    for (let i = 0; i < 5000; i++) {
        const o = twenty(i);
        if (i % 500 === 0) kept.push(o);
        if (i % 1000 === 999) Bun.gc(true);
        sum = (sum + o.t0 + o.t6 + o.t15 + o.t16 + o.t19) % 1000003;
    }
    say("twenty keys in a loop", sum, kept.map(checksum).join(), Object.keys(kept[3]).join());

    sum = 0;
    for (let i = 0; i < 20000; i++) {
        const o = under((i & 3) === 3 ? null : parent, i);
        sum += (o.watched as number) + (o.fixed as number);
    }
    say("below a frozen prototype in a loop", sum, setterCalls, describe(under(parent, 5)), describe(under(null, 6)));

    sum = 0;
    for (let i = 0; i < 20000; i++) {
        const o = withExtras(i);
        sum = (sum + o.x + o.extraA + o.extraD) % 1000003;
    }
    say("members beside a field in a loop", sum, show(withExtras(9)), describe(withExtras(9)));

    sum = 0;
    for (let i = 0; i < 20000; i++) sum = (sum + checksum(repeated(i))) % 1000003;
    say("every name written twice in a loop", sum, show(repeated(1)));

    const rare: string[] = [];
    for (let i = 0; i < 20000; i++) {
        const o = seldom(i);
        if (o) rare.push(show(o));
    }
    say("in a branch that is seldom taken", rare.join(" ; "));

    tryOnObjectPrototype("second", { get() { return "inherited"; }, set() { setterCalls += 100; }, configurable: true });
    tryOnObjectPrototype("c", { value: "read-only", writable: false, configurable: true });
    say("after Object.prototype may have changed", describe(four(1, 2, "three", true)), describe(six(1)), describe(repeated(1)), setterCalls);
    removeFromObjectPrototype("second");
    removeFromObjectPrototype("c");
    say("after it was put back", describe(four(1, 2, "three", true)), describe(six(1)), setterCalls);
}

console.log(out.join("\n"));
