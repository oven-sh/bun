// through a proxy
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
const seen: string[] = [];
const plain: N[] = []; const proxy: N[] = new Proxy<N[]>([], { get(t, k, r) { seen.push(String(k)); return k === "1" ? "from the trap" : Reflect.get(t, k, r); } });
function fill(list: N[]) { list.push({ v: 1 }); list.push({ v: 2 }); { const got: string[] = []; for (let i = 0; i < hidden<number>("3"); i++) got.push(say(list[i])); out.push(got.join()); } }
fill(plain); fill(proxy); out.push(seen.join());
console.log(out.join(" | "));
