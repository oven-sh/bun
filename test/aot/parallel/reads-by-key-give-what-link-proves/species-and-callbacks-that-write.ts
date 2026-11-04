// species and callbacks that write
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
const list: any[] = []; list.push({ v: 1 }, { v: 2 }, { v: 3 });
list.forEach((n, i, all) => { if (i === 0) all[2] = "written in the callback"; out.push(say(all[i])); });
list.map((n, i, all) => { all.push("grown " + i); return n; });
{ const got: string[] = []; for (let i = 0; i < hidden<number>("7"); i++) got.push(say(list[i])); out.push(got.join()); }
console.log(out.join(" | "));
