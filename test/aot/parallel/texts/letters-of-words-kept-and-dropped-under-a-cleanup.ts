// The inner for-of steps a word under the cleanup of the outer one. Where the letter is only asked for its code or compared, its text is never made; where it is kept, it is. Whatever is thrown in a turn
// still comes to the cleanups, in their order, with what the turns before it have left.
let closed = "";
function stepped<T>(name: string, values: T[]): Iterable<T> {
  return {
    [Symbol.iterator]() {
      let at = 0;
      return {
        next() { return at < values.length ? { done: false, value: values[at++]! } : { done: true, value: undefined as never }; },
        return() { closed += name + ";"; return { done: true, value: undefined as never }; },
      };
    },
  };
}
function codes(words: Iterable<string>): number { let sum = 0; for (const word of words) { for (const letter of word) sum += letter.charCodeAt(0); } return sum; }
function points(words: Iterable<string>): number { let sum = 0; for (const word of words) { for (const letter of word) sum += letter.codePointAt(0)!; } return sum; }
function slashes(words: Iterable<string>): number { let count = 0; for (const word of words) { for (const letter of word) if (letter === "/" || letter === "中") count++; } return count; }
function pushed(words: Iterable<string>): string { const kept: string[] = []; for (const word of words) { for (const letter of word) kept.push(letter); } return kept.join("|"); }
function last(words: Iterable<string>): string { let sum = 0, seen = ""; for (const word of words) { for (const letter of word) { sum += letter.charCodeAt(0); seen = letter; } } return sum + seen; }
function behindX(words: Iterable<string>): number { let count = 0, before = ""; for (const word of words) { for (const letter of word) { if (before === "x") count++; before = letter; } } return count; }
function joined(words: Iterable<string>): string { let out = ""; for (const word of words) { for (const letter of word) out += letter; out += "."; } return out; }
function seldom(words: Iterable<string>, into: Set<string>): number { let sum = 0; for (const word of words) { for (const letter of word) { if ((sum & 63) === 63) into.add(letter); sum += letter.charCodeAt(0); } } return sum; }
function until(words: Iterable<string>, stop: number): number { let sum = 0; for (const word of words) { for (const letter of word) { if (letter.charCodeAt(0) === stop) throw new RangeError("at " + sum); sum += letter.charCodeAt(0); } } return sum; }
function leaves(words: Iterable<string>, stop: number): number { let sum = 0; outer: for (const word of words) { for (const letter of word) { if (letter.charCodeAt(0) === stop) break outer; sum += letter.charCodeAt(0); } } return sum; }
function tried(run: () => unknown): string {
  closed = "";
  try { return String(run()) + " [" + closed + "]"; } catch (error) { return (error as Error).name + ":" + (error as Error).message + " [" + closed + "]"; }
}
const hidden = <T,>(value: T): T => JSON.parse(JSON.stringify({ value })).value;
const narrow = hidden(["request/path-a", "xy", "", "x/"]);
const wide = hidden(["café/中文", "a😀x", "\ud83d", "x\ude00"]);
const ropes = [narrow[0] + wide[0]!, wide[1] + narrow[1]! + narrow[3]];
for (let turn = 0; turn < 3; turn++) {
  for (const words of [narrow, wide, ropes, []]) {
    const into = new Set<string>();
    console.log(codes(words), points(words), slashes(words), pushed(words), last(words), behindX(words), joined(words), seldom(words, into), [...into].join());
  }
}
for (const words of [narrow, wide, ropes]) {
  console.log(tried(() => codes(stepped("outer", words))), tried(() => last(stepped("outer", words))), tried(() => pushed(stepped("outer", words))));
  console.log(tried(() => until(stepped("outer", words), 120)), tried(() => until(words, 120)), tried(() => until(stepped("outer", words), 7)));
  console.log(tried(() => leaves(stepped("outer", words), 120)), tried(() => leaves(words, 47)), tried(() => leaves(stepped("outer", words), 7)));
}
const lies = [["ab", 7], ["ab", undefined], ["ab", stepped("inner", ["c", "de"])], ["ab", ["c", "de"]], [new String("ab"), "c"]] as unknown as string[][];
for (const words of lies) console.log(tried(() => codes(stepped("outer", words))), tried(() => last(stepped("outer", words))), tried(() => until(stepped("outer", words), 100)));
export {};
