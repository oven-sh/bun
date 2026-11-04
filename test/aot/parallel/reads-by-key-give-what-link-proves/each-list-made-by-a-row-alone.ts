// each list made by a row alone
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
const base: N[] = []; base.push({ v: 1 }, { v: 2 }, { v: 3 });
{ const l = base.map(n => n.v); { const got: string[] = []; for (let i = 0; i < hidden<number>("4"); i++) got.push(say(l[i])); out.push(got.join()); } }
{ const l = base.map(n => String(n.v)); { const got: string[] = []; for (let i = 0; i < hidden<number>("4"); i++) got.push(say(l[i])); out.push(got.join()); } }
{ const l = base.filter(n => n.v > 1); { const got: string[] = []; for (let i = 0; i < hidden<number>("4"); i++) got.push(say(l[i])); out.push(got.join()); } }
{ const l = base.slice(1); { const got: string[] = []; for (let i = 0; i < hidden<number>("4"); i++) got.push(say(l[i])); out.push(got.join()); } }
{ const l = base.concat(["more" as any]); { const got: string[] = []; for (let i = 0; i < hidden<number>("4"); i++) got.push(say(l[i])); out.push(got.join()); } }
{ const l = Array.from(base, n => n.v + 0.5); { const got: string[] = []; for (let i = 0; i < hidden<number>("4"); i++) got.push(say(l[i])); out.push(got.join()); } }
{ const l = [...base, 9 as any]; { const got: string[] = []; for (let i = 0; i < hidden<number>("4"); i++) got.push(say(l[i])); out.push(got.join()); } }
{ const l = Array.of(1, "two"); { const got: string[] = []; for (let i = 0; i < hidden<number>("4"); i++) got.push(say(l[i])); out.push(got.join()); } }
{ const l = base.flatMap(n => [n, n.v]); { const got: string[] = []; for (let i = 0; i < hidden<number>("4"); i++) got.push(say(l[i])); out.push(got.join()); } }
{ const l = Object.keys(base); { const got: string[] = []; for (let i = 0; i < hidden<number>("4"); i++) got.push(say(l[i])); out.push(got.join()); } }
{ const l = Object.values(base); { const got: string[] = []; for (let i = 0; i < hidden<number>("4"); i++) got.push(say(l[i])); out.push(got.join()); } }
{ const l = Object.entries(base); { const got: string[] = []; for (let i = 0; i < hidden<number>("4"); i++) got.push(say(l[i])); out.push(got.join()); } }
{ const l = base.toReversed(); { const got: string[] = []; for (let i = 0; i < hidden<number>("4"); i++) got.push(say(l[i])); out.push(got.join()); } }
{ const l = base.with(0, "with" as any); { const got: string[] = []; for (let i = 0; i < hidden<number>("4"); i++) got.push(say(l[i])); out.push(got.join()); } }
{ const l = new Array<N>(2); { const got: string[] = []; for (let i = 0; i < hidden<number>("4"); i++) got.push(say(l[i])); out.push(got.join()); } }
{ const l = Array<N>(2).fill(base[0]); { const got: string[] = []; for (let i = 0; i < hidden<number>("4"); i++) got.push(say(l[i])); out.push(got.join()); } }
{ const l = "a,b".split(","); { const got: string[] = []; for (let i = 0; i < hidden<number>("4"); i++) got.push(say(l[i])); out.push(got.join()); } }
{ const l = base.splice(0, 1); { const got: string[] = []; for (let i = 0; i < hidden<number>("4"); i++) got.push(say(l[i])); out.push(got.join()); } }
{ const l = base.toSorted(() => 1); { const got: string[] = []; for (let i = 0; i < hidden<number>("4"); i++) got.push(say(l[i])); out.push(got.join()); } }
{ const l = base.toSpliced(0, 0, true as any); { const got: string[] = []; for (let i = 0; i < hidden<number>("4"); i++) got.push(say(l[i])); out.push(got.join()); } }
console.log(out.join(" | "));
