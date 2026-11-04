// texts and typed arrays
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
const text = hidden<string>('"hello"'); const bytes = new Uint8Array(3); bytes[1] = 300; const floats = new Float64Array(2); floats[0] = 0.5; const big = new BigInt64Array(1); big[0] = 5n;
{ const got: string[] = []; for (let i = -1; i < hidden<number>("6"); i++) got.push(say(text[i])); out.push(got.join()); }{ const got: string[] = []; for (let i = -1; i < hidden<number>("4"); i++) got.push(say(bytes[i])); out.push(got.join()); }{ const got: string[] = []; for (let i = -1; i < hidden<number>("3"); i++) got.push(say(floats[i])); out.push(got.join()); }{ const got: string[] = []; for (let i = 0; i < hidden<number>("2"); i++) got.push(say(big[i])); out.push(got.join()); }{ const got: string[] = []; for (let i = -1; i < hidden<number>("4"); i++) got.push(say("lit"[i])); out.push(got.join()); }
console.log(out.join(" | "));
