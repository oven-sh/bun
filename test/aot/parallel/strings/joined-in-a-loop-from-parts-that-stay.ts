// A string joined in a loop from parts that the loop leaves alone is the same in every iteration. Whatever else the join does, it does where it stands.
const lines: string[] = [];
const say = (...parts: unknown[]) => void lines.push(parts.map(String).join(" "));
const made = (text: string) => text + String(Date.now()).slice(99);

const locks = new Map<string, number>();
for (let i = 0; i < 40; i++) locks.set(`section${i}.group${i % 7}.leaf${i % 3}`, i);

function hasKeyBelow(path: string): boolean {
  for (const key of locks.keys()) {
    if (key.startsWith(`${path}.`)) return true;
  }
  return false;
}
for (const path of ["other", "section5", "section39.group4", "section39.group4.leaf0", "", "section"]) say("below", path, hasKeyBelow(made(path)));

function countOf(keys: Iterable<string>, first: string, second: string, third: number): number {
  let count = 0;
  for (const key of keys) {
    if (key.endsWith(first + second)) count++;
    if (key.includes(`${second}${third}.`)) count += 10;
    if (key.indexOf(first + "." + second + third) >= 0) count += 100;
    if (key === `section${third}.${second}${third}${first}`) count += 1000;
  }
  return count;
}
say("counts", countOf(locks.keys(), made(".leaf"), made("2"), 2), countOf(locks.keys(), made("2"), made("group"), 2), countOf(new Set<string>(), made("a"), made("b"), 1), countOf(["section2.group2.leaf2"], made(".leaf2"), made("group"), 2));

// A part that changes.
function changing(list: string[], start: string): string {
  let prefix = start;
  let out = "";
  for (const item of list) {
    out += `${prefix}-` + item + ";";
    if (item === "b") prefix = prefix + "!";
  }
  return out;
}
say(changing(["a", "b", "c", "b", "d"], made("p")));

function changesOutside(rows: string[], columns: string[]): string[] {
  const out: string[] = [];
  for (const row of rows) {
    for (const column of columns) out.push(`<${row}>` + column);
  }
  return out;
}
say(changesOutside([made("r1"), made("r2"), made("r3")], ["x", "y"]).join());

function staysInBoth(rows: number, columns: number, a: string, b: string): number {
  let length = 0;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < columns; j++) length += (a + ":" + b).length + j;
  }
  return length;
}
say(staysInBoth(3, 4, made("left"), made("right")), staysInBoth(0, 4, made("left"), made("right")), staysInBoth(3, 0, made("left"), made("right")));

// Only some iterations get to the join.
function someGetThere(list: number[], name: string): string {
  const out: string[] = [];
  for (const n of list) {
    if (n % 3 === 0) continue;
    if (n > 8) break;
    out.push(n % 2 ? `${name}#` : "even");
  }
  return out.join();
}
say(someGetThere([3, 6, 2, 1, 4, 5, 7, 9, 11, 1], made("odd")), "|", someGetThere([3, 6, 9], made("odd")), "|", someGetThere([], made("odd")));

// A string that would be too long is refused where the join stands: behind what the iteration did before, and not at all where no iteration gets there.
let long = made("0123456789abcdef");
for (let i = 0; i < 26; i++) long += long;
say("length", long.length);
function tooLong(list: number[], left: string, right: string): string {
  const seen: number[] = [];
  try {
    for (const n of list) {
      seen.push(n);
      if (n < 0) continue;
      if ((left + right).length < n) seen.push(-n);
      seen.push(n * 2);
    }
  } catch (error) {
    return `${(error as Error).constructor.name} behind ${seen.join()}`;
  }
  return `none behind ${seen.join()}`;
}
say(tooLong([], long, long), "|", tooLong([-1, -2], long, long), "|", tooLong([-1, 5, 6], long, long), "|", tooLong([7, 8], made("a"), made("b")));
function caughtInside(times: number, left: string, right: string): string {
  let caught = 0;
  let joined = 0;
  for (let i = 0; i < times; i++) {
    try {
      joined += `${left}${right}`.length;
    } catch {
      caught++;
    }
  }
  return `${caught} ${joined}`;
}
say(caughtInside(3, long, long), "|", caughtInside(3, made("ab"), made("c")), "|", caughtInside(0, long, long));

// Parts that are no strings.
function otherParts(times: number, n: number, flag: boolean, nothing: null | undefined, big: bigint): string {
  let last = "";
  for (let i = 0; i < times; i++) last = `${n}|${flag}|${nothing}|${big}|` + i;
  return last;
}
say(otherParts(3, -0, true, null, 12n), otherParts(2, NaN, false, undefined, -5n), otherParts(2, 1e21, false, undefined, 0n), otherParts(2, 0.1 + 0.2, true, null, 1n));

// An object is asked for its text in every iteration.
let asked = 0;
const teller = { toString() { return `t${++asked}`; } };
function asksObject(times: number, part: { toString(): string }): string {
  const out: string[] = [];
  for (let i = 0; i < times; i++) out.push(`${part}.`);
  return out.join();
}
say(asksObject(3, teller), asked);
function symbolPart(times: number, part: unknown): string {
  let reached = 0;
  try {
    for (let i = 0; i < times; i++) {
      reached++;
      if (`${part as string}.`.length < 0) reached = -1;
    }
  } catch (error) {
    return `${(error as Error).constructor.name} ${reached}`;
  }
  return `none ${reached}`;
}
say(symbolPart(2, Symbol("s")), symbolPart(0, Symbol("s")), symbolPart(2, made("s")));

// The test of the loop joins.
function inTheTest(text: string, a: string, b: string): number {
  let turns = 0;
  while (text.startsWith(a + b)) {
    text = text.slice(a.length + b.length);
    turns++;
  }
  do turns += 100;
  while (text.endsWith(b + a) && (text = text.slice(0, -2)).length > 0);
  return turns;
}
say(inTheTest(made("ababababxbaba"), made("a"), made("b")), inTheTest(made("x"), made("a"), made("b")));

// Loops that stop in the middle and go on later.
function* yields(times: number, a: string, b: string) {
  for (let i = 0; i < times; i++) yield `${a}/${b}` + i;
}
say([...yields(3, made("g"), made("h"))].join());
async function awaits(times: number, a: string, b: string) {
  const out: string[] = [];
  for (let i = 0; i < times; i++) out.push((await i) + `${a}~${b}`);
  return out.join();
}

// What is joined is kept by somebody.
function keeps(times: number, a: string, b: string) {
  const kept: string[] = [];
  const tellers: (() => string)[] = [];
  for (let i = 0; i < times; i++) {
    const joined = a + "+" + b;
    kept.push(joined);
    tellers.push(() => joined + i);
  }
  return [new Set(kept).size, kept.join(), tellers.map(f => f()).join()].join(" ");
}
say(keeps(3, made("k"), made("l")));

// A variable that a closure writes.
function writtenElsewhere(list: string[]) {
  let prefix = made("w");
  const change = () => void (prefix += "'");
  const out: string[] = [];
  for (const item of list) {
    out.push(`${prefix}:` + item);
    if (item === "y") change();
  }
  return out.join();
}
say(writtenElsewhere(["x", "y", "z"]));

// A loop with a label, a loop entered from a branch, and a loop in a finally.
function shapes(flag: boolean, a: string, b: string): string {
  const out: string[] = [];
  outer: for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (j === 2) continue outer;
      if (i === 2) break outer;
      out.push(`${a}${b}` + i + j);
    }
  }
  if (flag) for (let i = 0; i < 2; i++) out.push(b + a);
  try {
    out.push("try");
  } finally {
    for (let i = 0; i < 2; i++) out.push(`${b}_${a}`);
  }
  return out.join();
}
say(shapes(true, made("s"), made("t")), shapes(false, made("s"), made("t")));

// Many iterations, with collections among them.
function many(times: number, a: string, b: string): number {
  let sum = 0;
  for (let i = 0; i < times; i++) {
    sum += `${a}.${b}`.charCodeAt(i % 5);
    if (i % 50000 === 0) Bun.gc(true);
  }
  return sum;
}
say(many(200000, made("ab"), made("cd")));

say(await awaits(3, made("m"), made("n")));
console.log(lines.join("\n"));
