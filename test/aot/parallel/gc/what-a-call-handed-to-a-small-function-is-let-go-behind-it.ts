// A call lets go of its arguments by itself: the frame of the callee ends. A small function whose body the compiler copies into its caller does the same: what another call handed
// back, and only the small function read, is collected while the caller still runs.
// Prints what the compiler saves: objects that are collected earlier
// Todo on win32 x64: Not every time: row 3517: some lines print that the object is kept: native frames there have home slots that nobody writes, and the collector reads what an earlier call left in them
// Todo under ASAN: Not every time: it says what is still alive, and there a stale copy of the pointer lies in a word of a frame that has ended on some runs and not on others
type Token = { kind: string; text: string; at: number };
let watched: WeakRef<Token[]> | undefined;
// Too long to be copied into its caller: it stays a call.
function split(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source.charCodeAt(i);
    if (c === 32 || c === 10) {
      i++;
      continue;
    }
    const start = i;
    if ((c >= 97 && c <= 122) || c === 95) {
      while (i < source.length) {
        const d = source.charCodeAt(i);
        if (!((d >= 97 && d <= 122) || d === 95 || (d >= 48 && d <= 57))) break;
        i++;
      }
      tokens.push({ kind: "name", text: source.slice(start, i), at: start });
    } else if (c >= 48 && c <= 57) {
      while (i < source.length && source.charCodeAt(i) >= 48 && source.charCodeAt(i) <= 57) i++;
      tokens.push({ kind: "number", text: source.slice(start, i), at: start });
    } else {
      i++;
      tokens.push({ kind: "sign", text: source[start]!, at: start });
    }
  }
  watched = new WeakRef(tokens);
  return tokens;
}
function countNames(tokens: Token[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) if (token.kind === "name") counts.set(token.text, (counts.get(token.text) ?? 0) + 1);
  return counts;
}
function same<T>(value: T): T {
  return value;
}
function first(tokens: Token[]): Token {
  return tokens[0]!;
}
let source = "";
for (let i = 0; i < 3; i++) source += `let v_${i} = foo_${i}(a${i} + ${i} * bar) - 12;\n`;
const lines: string[] = [];
function run(turns: number, what: string): number {
  let total = 0;
  for (let turn = 0; turn < turns; turn++) {
    const counts = countNames(split(source));
    Bun.gc(true);
    lines.push(`${what}, turn ${turn}: ${watched!.deref() === undefined ? "collected" : "KEPT"}`);
    total += counts.size;
  }
  return total;
}

// What is still named is still there.
function handedBack(): number {
  const tokens = same(split(source));
  Bun.gc(true);
  lines.push(`a small function hands its argument back: ${watched!.deref() === tokens}`);
  return countNames(tokens).size;
}
function partHandedBack(): number {
  const token = first(split(source));
  Bun.gc(true);
  lines.push(`a small function hands back a part of its argument: ${token.kind} ${token.text}`);
  return token.at;
}
function namedByCaller(): number {
  const tokens = split(source);
  const counts = countNames(tokens);
  Bun.gc(true);
  lines.push(`the caller names it too: ${watched!.deref() === tokens}`);
  return counts.size + tokens.length;
}
const sum = run(3, "the first call") + run(3, "the second call") + handedBack() + partHandedBack() + namedByCaller();
console.log(lines.join("\n"));
console.log(sum);
