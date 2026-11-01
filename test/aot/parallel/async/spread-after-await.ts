// An object spread, a rest pattern and two spreads in async functions that run once or a few times, after an await.
interface Options { timeout: number; label: string; verbose?: boolean }
interface Message { role: string; content: string; id: number }
const pending = Promise.resolve(1);
async function withCount(options: Options, count: number) { const extra = await pending; return { ...options, count: count + extra }; }
async function withoutId(message: Message) { await pending; const { id, ...rest } = message; return [id, rest]; }
async function merged(options: Options, message: Message) { await pending; return { first: 0, ...options, ...message, last: 1 }; }
async function ofNothing(options: Options | null | undefined) { await pending; return { ...options, done: true }; }
async function ofAccessor() { await pending; let reads = 0; const source = { a: 1, get b() { return ++reads; }, c: 3 }; return [{ ...source }, { ...source }, reads]; }
async function ofChanged(options: Options) { await pending; delete (options as Partial<Options>).label; (options as any).added = "x"; return { ...options }; }
async function main() {
  console.log(JSON.stringify(await withCount({ timeout: 1, label: "a" }, 2)));
  console.log(JSON.stringify(await withCount({ label: "b", timeout: 2, verbose: true }, 3)));
  console.log(JSON.stringify(await withoutId({ role: "user", content: "c", id: 7 })));
  console.log(JSON.stringify(await merged({ timeout: 1, label: "a" }, { role: "r", content: "c", id: 1 })));
  console.log(JSON.stringify(await ofNothing(null)), JSON.stringify(await ofNothing(undefined)), JSON.stringify(await ofNothing({ timeout: 0, label: "" })));
  console.log(JSON.stringify(await ofAccessor()));
  console.log(JSON.stringify(await ofChanged({ timeout: 5, label: "gone", verbose: false })));
  console.log(Object.keys(await withCount(Object.assign(Object.create({ inherited: 1 }), { timeout: 9, label: "own" }), 0)).join());
}
main();
