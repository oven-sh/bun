const out: string[] = [];
function ticks(name: string, count: number) { let promise = Promise.resolve(); for (let i = 0; i < count; i++) promise = promise.then(() => { out.push(name + i); }); }
const name = (error: unknown) => error instanceof Error ? error.message : String(error);
function check(n: number): number { if (n > 1) throw new RangeError("check" + n); return n; }
const table = { get bad(): number { throw new TypeError("getter"); }, parse(text: string): number { return JSON.parse(text); } };
async function throwsItself(n: number): Promise<number> { if (n > 1) throw new Error("own" + n); return n; }
async function throwsPrimitive(n: number): Promise<number> { if (n > 1) throw n; return n; }
async function calls(n: number): Promise<number> { return check(n); }
async function reads(n: number): Promise<number> { return n > 1 ? table.bad : n; }
async function parses(n: number): Promise<number> { return n > 1 ? table.parse("{") : n; }
async function nulls(n: number): Promise<number> { const list: number[] | undefined = n > 1 ? undefined : [n]; return list!.length; }
async function wide(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number): Promise<number> { return check(a) + b + c + d + e + f + g + h; }
const arrow = async (n: number): Promise<string> => { check(n); return "a" + n; };
class Holder { #n = 0; async method(n: number): Promise<number> { this.#n += check(n); return this.#n; } static async make(n: number): Promise<number> { return check(n); } }
const holder = new Holder();
async function inTry(n: number) { try { out.push("r" + await throwsItself(n)); } catch (error) { out.push("caught " + name(error)); } return "try"; }
async function inTryUnused(n: number) { try { await throwsItself(n); } catch { out.push("caught"); } }
async function noTry(n: number) { const r = await throwsItself(n); out.push("r" + r); return r; }
async function unused(n: number) { await calls(n); out.push("behind"); }
async function inFinally(n: number) { try { await calls(n); } finally { out.push("finally"); } }
async function nested(n: number) { try { try { await reads(n); } finally { out.push("inner"); } } catch (error) { out.push("outer " + name(error)); } await 0; out.push("end"); }
async function several(n: number) {
  let text = "";
  try { text += await throwsPrimitive(n); } catch (error) { text += name(error); }
  try { text += await parses(n) > 0; } catch { text += "p"; }
  try { text += await nulls(n); } catch { text += "n"; }
  try { text += await wide(n, 1, 2, 3, 4, 5, 6, 7); } catch { text += "w"; }
  try { text += await arrow(n); } catch { text += "a"; }
  try { text += await holder.method(n); } catch { text += "m"; }
  try { text += await Holder.make(n); } catch { text += "s"; }
  out.push(text);
}
async function waitsFirst(n: number) { await 0; try { await calls(n); } catch (error) { out.push("later " + name(error)); } await calls(0); return inTry(n); }
async function above(n: number) { try { await noTry(n); } catch (error) { out.push("above " + name(error)); } }
for (const start of [inTry, inTryUnused, noTry, unused, inFinally, nested, several, waitsFirst, above]) {
  for (const n of [0, 2]) {
    ticks("b" + n, 3);
    start(n).then(value => out.push(start.name + n + " done " + value), error => out.push(start.name + n + " failed " + name(error)));
    ticks("t" + n, 6);
    out.push("sync " + start.name + n);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}
console.log(out.join("\n"));
