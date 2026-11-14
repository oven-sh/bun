// Chains of comparisons of one value with literals, in loops: if, ternary, or, guards with continue and return, strings of every kind and values that are none.
class Token { kind: any; text = ""; constructor(kind: any) { this.kind = kind; } }
class Getter { asked = 0; get kind(): any { this.asked++; return ["add", "sub", "mul", "div", "none"][this.asked % 5]; } }
const words = ["add", "sub", "mul", "div", "const", "constant", "", "a", "ad", "addd", "ADD", "日本", "été", "identifier", "return"];
const joined = words.join(" ") + " tail", pieces = joined.split(" "), wide = (joined + "日").split(" ");
const ropes = words.map((w, k) => w.slice(0, 1 + (k & 1)) + w.slice(1 + (k & 1)));
const others: any[] = [0, 1, NaN, null, undefined, true, {}, [], ["add"], new String("add"), { toString: () => "sub" }, Symbol("add"), 10n, () => "mul"];
const strings: any[] = [...words, ...pieces, ...wide, ...ropes], values: any[] = [...strings, ...others];
function ifs(list: any[]): number[] { const out: number[] = []; for (let j = 0; j < list.length; j++) { const k = list[j]; let r = 0; if (k === "add") r = 1; else if (k === "sub") r = 2; else if (k === "mul") r = 3; else if (k === "div") r = 4; else if (k === "const") r = 5; else if (k === "constant") r = 6; else r = 100; out.push(r); } return out; }
function typed(list: string[]): number { let r = 0; for (const k of list) { if (k === "add") r += 1; else if (k === "identifier") r += 2; else if (k === "") r += 3; else if (k === "日本") r += 4; else if (k === "été") r += 5; r = (r * 3) % 1000003; } return r; }
function noDefault(list: any[]): number { let r = 0; for (const k of list) { if (k === "add") r += 1; else if (k === "sub") r += 2; else if (k === "mul") r += 3; r = (r * 5) % 1000003; } return r; }
function ternary(list: any[]): number { let r = 0; for (const k of list) r = (r * 7 + (k === "add" ? 1 : k === "sub" ? 2 : k === "return" ? 3 : k === "a" ? 4 : 5)) % 1000003; return r; }
function or(list: any[]): number { let r = 0; for (const k of list) { if (k === "add" || k === "sub" || k === "mul" || k === "a" || k === "") r += 1; else r += 10; r = (r * 3) % 1000003; } return r; }
function orValue(list: any[]): string { let out = ""; for (const k of list) { const is = k === "add" || k === "sub" || k === "mul"; out += is ? "y" : "n"; } return out; }
function not(list: any[]): number { let r = 0; for (const k of list) { if (k !== "add" && k !== "sub" && k !== "mul") r += 1; else r += 10; r = (r * 3) % 1000003; } return r; }
function guards(list: any[]): number { let r = 0; for (const k of list) { r = (r * 3) % 1000003; if (k === "add") continue; if (k === "sub") { r += 2; continue; } if (k === "mul") { r += 3; continue; } if (k === "return") return r; r += 50; } return -r; }
function kind(k: any): number { if (k === "add") return 1; if (k === "sub") return 2; if (k === "mul") return 3; if (k === "div") return 4; return 0; }
function calls(list: any[]): number { let r = 0; for (const k of list) r = (r * 3 + kind(k)) % 1000003; return r; }
function fields(list: Token[]): number { let r = 0; for (const t of list) { if (t.kind === "add") r += 1; else if (t.kind === "sub") r += 2; else if (t.kind === "mul") r += 3; else if (t.kind === "div") r += 4; else r += 9; r = (r * 3) % 1000003; } return r; }
function changed(list: Token[]): number { let r = 0; for (const t of list) { if (t.kind === "add") r += 1; else if ((t.kind = "mul") && t.kind === "sub") r += 2; else if (t.kind === "mul") r += 3; else if (t.kind === "div") r += 4; r = (r * 3) % 1000003; } return r; }
function getters(g: Getter): string { let out = ""; for (let j = 0; j < 12; j++) { if (g.kind === "add") out += "1"; else if (g.kind === "sub") out += "2"; else if (g.kind === "mul") out += "3"; else if (g.kind === "div") out += "4"; else out += "0"; } return out + g.asked; }
function between(list: any[], f: (k: any) => boolean): number { let r = 0; for (const k of list) { if (k === "add") r += 1; else if (f(k)) r += 2; else if (k === "sub") r += 3; else if (k === "mul") r += 4; else if (k === "div") r += 5; r = (r * 3) % 1000003; } return r; }
function repeated(list: any[]): number { let r = 0; for (const k of list) { if (k === "add") r += 1; else if (k === "add") r += 2; else if (k === "sub") r += 3; else if (k === "add") r += 4; else if (k === "mul") r += 5; r = (r * 3) % 1000003; } return r; }
function loose(list: string[]): number { let r = 0; for (const k of list) { if (k == "add") r += 1; else if (k == "sub") r += 2; else if (k == "mul") r += 3; else if (k == "") r += 4; r = (r * 3) % 1000003; } return r; }
function looseAny(list: any[]): string { let out = ""; for (const k of list) { try { if (k == "add") out += 1; else if (k == "sub") out += 2; else if (k == "mul") out += 3; else if (k == "") out += 4; else out += "."; } catch { out += "!"; } } return out; }
function narrowed(list: ("add" | "sub" | "mul" | "div")[]): number { let r = 0; for (const k of list) { if (k === "add") r += k.length; else if (k === "sub") r += k.length * 2; else if (k === "mul") r += k.length * 3; else r += k.length * 4 + k.charCodeAt(0); r %= 1000003; } return r; }
function numbers(list: any[]): number { let r = 0; for (const k of list) { if (k === "add") r += 1; else if (k === 1) r += 2; else if (k === "sub") r += 3; else if (k === "mul") r += 4; else if (k === null) r += 5; else if (k === "a") r += 6; r = (r * 3) % 1000003; } return r; }
function assigned(list: any[]): string { let out = ""; for (let k of list) { let next = ""; if (k === "add") next = "sub"; else if (k === "sub") next = "mul"; else if (k === "mul") next = "div"; else next = "add"; k = next; if (k === "sub") out += "s"; else if (k === "mul") out += "m"; else if (k === "div") out += "d"; else out += "a"; } return out; }
function tried(list: any[]): number { let r = 0; for (const k of list) { try { if (k === "add") throw 1; else if (k === "sub") r += 2; else if (k === "mul") throw 3; else if (k === "div") r += 4; else r += 5; } catch (e) { r += (e as number) * 10; } r = (r * 3) % 1000003; } return r; }
function* yields(list: any[]): Generator<number> { for (const k of list) { if (k === "add") yield 1; else if (k === "sub") yield 2; else if (k === "mul") yield 3; else yield 0; } }
async function awaited(list: any[]): Promise<number> { let r = 0; for (const k of list) { if (k === "add") r += await 1; else if (k === "sub") r += await 2; else if (k === "mul") r += 3; else r += 4; r = (r * 3) % 1000003; } return r; }
const tokens = values.map(v => new Token(v)), no = () => false, some = (k: any) => typeof k === "number" || k === "sub";
for (let turn = 0; turn < 30; turn++) {
  const line = [ifs(values).join(""), typed(strings), noDefault(values), ternary(values), or(values), orValue(values), not(values), guards(values), guards(others), calls(values), fields(tokens), changed(values.map(v => new Token(v))), getters(new Getter()), between(values, no), between(values, some), repeated(values), loose(strings), looseAny(others.filter(v => typeof v !== "symbol")), narrowed(["add", "sub", "mul", "div", pieces[1] as any, ropes[3] as any]), numbers(values), assigned(values), tried(values), [...yields(values)].join("")].join("|");
  if (turn === 0 || turn === 29) console.log(line);
}
awaited(values).then(r => console.log(r));
