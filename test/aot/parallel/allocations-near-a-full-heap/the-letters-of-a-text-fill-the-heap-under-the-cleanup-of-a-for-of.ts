// Env: BUN_JSC_markedBlockCageSizeInMB=64
// The inner loop steps a word under the cleanup of the for-of around it, which steps an iterator of the program's own. The letters are kept, so the range of the program's objects fills in a turn of the inner
// loop: the RangeError must come to that cleanup, which calls return() once, and then to the catch clause. return() counts and makes nothing.
// `bun <file>` has no such range: there nothing is thrown and nothing is closed. What is printed holds for both.
const hidden = <T,>(value: T): T => JSON.parse(JSON.stringify({ value })).value;
const word: string = hidden("中文".repeat(50_000));
let caught = 0, escaped = 0, stored = 0, isRange = false, closed = 0;
const keep: string[] = [];
for (let i = 0; i < 5_000_000; i++) keep.push("");
const ended = { done: true, value: undefined as never };
function stepped<T>(values: T[]): Iterable<T> {
  return { [Symbol.iterator]() { let at = 0; return { next() { return at < values.length ? { done: false, value: values[at++]! } : ended; }, return() { closed++; return ended; } }; } };
}
function lay(words: Iterable<string>): void { for (const one of words) { for (const letter of one) keep[stored++] = letter; } }
const words: string[] = [];
for (let i = 0; i < 50; i++) words.push(word);
function fill(): void {
  try { lay(stepped(words)); } catch (error) { caught++; isRange = error instanceof RangeError; }
}
try { fill(); } catch { escaped++; }
keep.length = 0;
Bun.gc(true);
if (process.env.SAY_WHAT_CAME) console.error("SAID caught=" + caught + " escaped=" + escaped + " closed=" + closed + " stored=" + stored);
console.log(escaped ? "outside" : "inside", caught ? caught === 1 && isRange && stored < 5_000_000 : stored === 5_000_000, closed === caught);
export {};
