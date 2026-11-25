const out: string[] = [];
const names = (error: unknown) => error instanceof Error ? error.name + " " + error.message + " " + String(error.stack).split("\n").slice(1).map(line => line.trim().replace(/^at /, "").replace(/ ?\(.*\)$/, "").replace(/^\/.*$/, "module")).filter(name => name !== "module" && !/native|unknown|plain-callees/.test(name)).join(" < ") : String(error);
function deep(n: number): number { if (n === 0) throw new RangeError("deep"); return deep(n - 1) + 1; }
function check(n: number): number { if (n % 3 === 0) throw n % 2 ? new TypeError("odd " + n) : n; return n; }
async function number(n: number): Promise<number> { return check(n) * 2; }
async function half(n: number): Promise<number> { return check(n) / 2; }
async function text(n: number): Promise<string> { return "t" + check(n); }
async function flag(n: number): Promise<boolean> { return check(n) > 2; }
async function nothing(n: number): Promise<void> { check(n); }
async function record(n: number): Promise<{ n: number; name: string }> { return { n: check(n), name: "r" + n }; }
async function list(n: number): Promise<number[]> { return [check(n), n + 1]; }
async function falls(n: number): Promise<number> { return deep(n); }
async function caughtInside(n: number): Promise<number> { try { return check(n); } catch { return -1; } finally { out.push("inside " + n); } }
async function thenable(n: number): Promise<unknown> { return { then(resolve: (x: number) => void) { out.push("then " + n); resolve(check(n + 1)); } }; }
async function promise(n: number): Promise<number> { return n % 2 ? Promise.resolve(n) : Promise.reject(new Error("p" + n)); }
async function many(a: number, b: string, c: number, d: boolean, e: number, f: number, g: string, h: number): Promise<string> { return check(a) + b + c + d + e + f + g + h; }
async function rest(...all: number[]): Promise<number> { return all.map(check).length; }
class Store { #n = 0; async add(n: number): Promise<number> { this.#n += check(n); return this.#n; } async get(): Promise<number> { return this.#n; } static async zero(): Promise<number> { return 0; } }
const store = new Store();
const micro = (name: string) => queueMicrotask(() => out.push("micro " + name));
async function each(n: number): Promise<string> {
  let sum = "";
  micro("a" + n);
  sum += await number(n);
  micro("b" + n);
  sum += " " + await half(n) + " " + await text(n) + " " + await flag(n) + " " + await nothing(n);
  const r = await record(n);
  sum += " " + r.n + r.name + " " + (await list(n)).join() + " " + await caughtInside(n) + " " + await many(n, "b", 3, true, 5.5, n, "g", 8) + " " + await rest(n, n + 3);
  sum += " " + await store.add(n) + " " + await store.get() + " " + await Store.zero();
  return sum;
}
async function kept(n: number): Promise<string> {
  const before = "k" + n, big = [n, n + 1];
  let caught = "";
  try { caught += await number(n); } catch (error) { caught += "1 " + names(error); }
  try { caught += " " + await text(n + 1); } catch { caught += " 2"; }
  try { caught += " " + await falls(n); } catch (error) { caught += " 3 " + names(error); } finally { micro("finally " + n); }
  try { caught += " " + (await record(n)).name; } catch (error) { caught += " 4 " + (error instanceof Error ? error.message : error); }
  try { caught += " " + await promise(n); } catch (error) { caught += " 5 " + names(error); }
  try { caught += " " + await thenable(n); } catch (error) { caught += " 6 " + names(error); }
  caught += " " + await caughtInside(n);
  return before + caught + big.join();
}
async function through(n: number): Promise<number> { return await number(n); }
async function outer(n: number): Promise<string> {
  const a = await kept(n);
  let b: unknown;
  try { b = await through(n); } catch (error) { b = names(error); }
  try { await nothing(n); } catch (error) { b += " " + names(error); }
  const started = number(n);
  try { b += " " + await started; } catch (error) { b += " started " + names(error); }
  return a + " | " + b;
}
async function main() {
  for (let i = 0; i < 7; i++) { try { out.push(await each(i)); } catch (error) { out.push("each " + names(error)); } out.push(await outer(i)); }
  await 0;
  for (let i = 0; i < 7; i++) { try { out.push(await each(i)); } catch (error) { out.push("each " + names(error)); } out.push(await outer(i)); }
}
async function unhandled() { await nothing(3); }
process.on("unhandledRejection", error => console.log("unhandled " + names(error)));
await main();
for (let i = 0; i < 7; i++) { try { out.push(await each(i)); } catch (error) { out.push("top " + names(error)); } out.push(await outer(i)); }
void unhandled();
setTimeout(async () => { try { out.push("timer " + await each(1) + await outer(2)); } catch (error) { out.push("timer " + names(error)); } console.log(out.join("\n")); }, 1);
