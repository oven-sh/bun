// null and undefined are pushed
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
const list: Array<N | null | undefined> = []; list.push(null, undefined, { v: 1 });
{ const got: string[] = []; for (let i = 0; i < hidden<number>("4"); i++) got.push(say(list[i])); out.push(got.join()); }
console.log(out.join(" | "));
