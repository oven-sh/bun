// lists out of json
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
const list = hidden<any[]>('[{"v":1}, "text", 3, null, [4]]'); const own: any[] = JSON.parse('[{"v":1}, "text", 3.5, null, [4]]');
{ const got: string[] = []; for (let i = 0; i < hidden<number>("6"); i++) got.push(say(list[i])); out.push(got.join()); }{ const got: string[] = []; for (let i = 0; i < hidden<number>("6"); i++) got.push(say(own[i])); out.push(got.join()); }
console.log(out.join(" | "));
