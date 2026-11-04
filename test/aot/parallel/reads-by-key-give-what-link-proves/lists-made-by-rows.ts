// lists made by rows
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
const base: N[] = []; base.push({ v: 1 }, { v: 2 }, { v: 3 });
const made: any[][] = [base.map(n => n.v), base.filter(n => n.v > 1), base.slice(1), base.concat(["more" as any]), Array.from(base, n => String(n.v)), [...base, 9 as any], Array.of(1, "two"), base.flatMap(n => [n, n.v]), Object.keys(base), Object.values(base), Object.entries(base), base.toReversed(), base.with(0, "with" as any), new Array(2), Array(2).fill(base[0]), "a,b".split(","), structuredClone(base)];
for (const l of made) { const got: string[] = []; for (let i = 0; i < hidden<number>("4"); i++) got.push(say(l[i])); out.push(got.join()); }
console.log(out.join(" | "));
