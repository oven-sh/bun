// frozen and sealed
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
const list: N[] = []; list.push({ v: 1 }); Object.freeze(list);
try { list.push({ v: 2 }); } catch (e) { out.push((e as Error).constructor.name); } try { (list as any)[0] = "x"; } catch (e) { out.push((e as Error).constructor.name); }
{ const got: string[] = []; for (let i = 0; i < hidden<number>("2"); i++) got.push(say(list[i])); out.push(got.join()); }
console.log(out.join(" | "));
