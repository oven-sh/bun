const out: string[] = [];
const names = (error: unknown) => String((error as Error).stack).split("\n").slice(0, 9).map(l => l.trim().replace(/\(.*\/(.*)\)/, "($1)").replace(/at \/.*\//, "at ")).join(" | ");
async function leaf(n: number): Promise<number> { if (n === 0) throw new Error("early"); await n; if (n === 1) throw new RangeError("late"); const x = await n; if (n === 2) (null as unknown as number[]).length; return x; }
async function middle(n: number): Promise<number> { try { return await leaf(n); } catch (error) { out.push("middle " + names(error)); if (n < 2) throw error; return -n; } finally { out.push("finally " + n); await leaf(5); } }
async function nothing(n: number): Promise<number> { return await leaf(n); }
async function direct(n: number): Promise<number> { return leaf(n); }
async function caught(n: number): Promise<number> { let sum = 0; for (let i = 0; i < 3; i++) { try { sum += await nothing(n - i); } catch (error) { out.push("caught " + i + " " + names(error)); sum += await leaf(9); } } return sum; }
async function rejects(n: number): Promise<number> { await n; return Promise.reject(new Error("given " + n)); }
async function thenable(n: number): Promise<unknown> { await n; return { then(resolve: (x: string) => void, reject: (x: string) => void) { out.push("then"); if (n & 1) reject("no " + n); else resolve("yes " + n); } }; }
async function all(n: number) {
  for (const f of [middle, nothing, direct, caught, rejects, thenable]) { try { out.push(f.name + " " + await f(n)); } catch (error) { out.push(f.name + " threw " + (error instanceof Error ? names(error) : error)); } }
  try { out.push("a " + await middle(n)); } catch (error) { out.push("a " + names(error)); }
  try { out.push("b " + await nothing(n)); } catch (error) { out.push("b " + names(error)); }
  try { out.push("c " + await direct(n)); } catch (error) { out.push("c " + names(error)); }
  try { out.push("d " + await caught(n)); } catch (error) { out.push("d " + names(error)); }
  try { out.push("e " + await rejects(n)); } catch (error) { out.push("e " + names(error)); }
  try { out.push("f " + await thenable(n)); } catch (error) { out.push("f " + error); }
}
async function main() { await 0; for (let i = 0; i < 5; i++) await all(i); }
await main();
for (let i = 0; i < 4; i++) { await all(i); try { out.push("top " + await middle(i)); } catch (error) { out.push("top " + names(error)); } }
setTimeout(async () => { await all(1); try { await nothing(1); } catch (error) { out.push("timer " + names(error)); } console.log(out.join("\n")); }, 1);
