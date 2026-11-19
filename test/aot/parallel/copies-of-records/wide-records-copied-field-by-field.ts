// Records of many fields, copied by `{ ...record, name: value }`: out of one written type, out of a union of two, with names before and behind the copy, through a record that lacks one, and out of order.
declare const process: { readonly argv: readonly string[] };
export {};
interface Wide { a0: number; a1: number; a2: string; a3: number; a4: boolean; a5: number; a6: number[]; a7: number; a8: string; a9: number; b0: number; b1: number }
interface Other extends Wide { extra: string }
const turns = process.argv.length + 2;
const make = (n: number): Wide => ({ a0: n, a1: n + 1, a2: `t${n}`, a3: n * 3, a4: n % 2 === 0, a5: n - 5, a6: [n], a7: 7, a8: "eight", a9: 9, b0: n / 2, b1: 11 });
const reversed = (n: number): Wide => ({ b1: 11, b0: n / 2, a9: 9, a8: "eight", a7: 7, a6: [n], a5: n - 5, a4: n % 2 === 0, a3: n * 3, a2: `t${n}`, a1: n + 1, a0: n });
const other = (n: number): Other => ({ extra: "more", ...make(n) });
const set0 = (wide: Wide, value: number): Wide => ({ ...wide, a0: value });
const set5 = (wide: Wide, value: number): Wide => ({ ...({ a5: 1 } as Partial<Wide>), ...wide, b1: value, a3: value + 1 });
const both = (one: Wide, two: Wide): Wide => ({ ...one, ...two, a7: one.a7 + two.a7 });
const either = (wide: Wide | Other, value: number): Wide => ({ ...wide, a9: value });
const late = (wide: Wide, value: () => number): Wide => ({ ...wide, a1: value() });
const tell = (wide: Wide) => Object.entries(wide).map(([key, value]) => `${key}:${String(value)}`).join(" ");
const lines: string[] = [];
for (let i = 0; i < turns; i++) {
    for (const made of [make(i), reversed(i), other(i)]) {
        lines.push(tell(set0(made, 100 + i)), tell(set5(made, i)), tell(both(made, make(i + 1))), tell(both(make(i + 1), made)), tell(either(made, -i)), tell(late(made, () => i * 1.5)));
        try { lines.push(tell(late(made, () => { throw new RangeError("late"); }))); } catch (error) { lines.push((error as Error).name); }
    }
    const lacking = make(i) as any;
    delete lacking.a8;
    lines.push(tell(set0(lacking, 1)), tell(set5(lacking, 2)), String(set0(lacking, 1).a8));
    const read = Object.defineProperty(make(i), "a2", { enumerable: i % 2 === 0, get() { return "got"; } });
    lines.push(tell(set0(read, 3)), String(set5(read, 4).a2), tell(set0(Object.freeze(make(i)) as Wide, 5)), tell(set0(JSON.parse(JSON.stringify(make(i))), 6)), tell(set0(Object.create(make(i)), 7)));
}
console.log(lines.join("\n"));
