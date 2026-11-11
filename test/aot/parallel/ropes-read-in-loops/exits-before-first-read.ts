// Loops read ropes by character behind exits of many kinds: the first iteration leaves, a later one leaves, none does. Narrow, wide, short, long, deep and substring ropes, and strings that are flat.
const pieces: string[] = ["abc", "déf", "漢字", "", "x", "0123456789", "😀", "end"];
function join(seed: number, count: number): string { let s = ""; for (let i = 0; i < count; i++) s += pieces[(seed + i * 3) % pieces.length]; return s; }
function strings(): string[] {
  const made: string[] = [];
  for (let seed = 0; seed < 8; seed++) for (const count of [0, 1, 2, 5, 40]) made.push(join(seed, count));
  const long = "a longer piece of a string that is copied only once ".repeat(40);
  for (let i = 0; i < 4; i++) { made.push(long + i, i + long, (long + i).slice(3), (long + "漢" + i).slice(2, 1500), long + long + (long + i)); }
  let deep = ""; for (let i = 0; i < 3000; i++) deep = deep + (i % 10); made.push(deep, deep + "漢");
  let left = "tail"; for (let i = 0; i < 3000; i++) left = (i % 10) + left; made.push(left);
  made.push("flat", "漢flat", "flat string".slice(1, 4));
  return made;
}

function exitOnMark(s: string, marks: boolean[]): number { let n = 0; for (let i = 0; i < s.length; i++) { if (marks[i]) return -1 - n; n = (n * 31 + s.charCodeAt(i)) | 0; } return n; }
function exitOnElement(list: string[], stop: string, s: string): number { let n = 0; for (let i = 0; i < list.length; i++) { if (list[i] === stop) break; n += s.charCodeAt(i); } return n; }
function exitOnCount(s: string, max: number): number { let n = 0; for (let i = 0; i < s.length; i++) { if (n > max) break; if (s.charCodeAt(i) !== 97) n++; } return n; }
function exitOnStart(s: string, from: number, end: number): number { let n = 0; for (let i = from; i < end; i++) { if (i >= s.length) break; if (i < 0) return -7; n += s.charCodeAt(i); } return n; }
function exitOnField(s: string, state: { done: boolean; n: number }): number { for (let i = 0; i < s.length; i++) { if (state.done) break; if (s.charCodeAt(i) === 98) state.done = true; state.n += i; } return state.n; }
function exitOnCall(s: string, stop: (i: number) => boolean): number { let n = 0; for (let i = 0; i < s.length; i++) { if (stop(i)) break; n ^= s.charCodeAt(i) << (i & 7); } return n; }
function throws(s: string, list: (string | null)[]): string { let n = 0; try { for (let i = 0; i < s.length; i++) { n += list[i % list.length]!.length + s.charCodeAt(i); } } catch (e) { return (e as Error).name + n; } return String(n); }
function onOneArm(s: string, marks: boolean[]): number { let n = 0; for (let i = 0; i < s.length; i++) { if (i > 500) break; if (marks[i % 3]) n += s.charCodeAt(i); } return n; }
function nested(rows: boolean[][], s: string): number { let n = 0; for (const row of rows) { for (let i = 0; i < s.length; i++) { if (row[i % 4]) break; n += s.charCodeAt(i); } } return n; }
function twoReads(s: string, marks: boolean[]): number { let n = 0; for (let i = 0; i + 1 < s.length; i++) { if (marks[i]) break; n += s.charCodeAt(i) * 2 + s.charCodeAt(i + 1); } return n; }
function tokens(s: string): number { let at = 0, n = 0; const end = s.length; while (true) { if (at >= end) break; let c = s.charCodeAt(at); if (c === 32) { at++; continue; } n++; while (at < end && (c = s.charCodeAt(at)) !== 32) at++; } return n; }
function fromBack(s: string, marks: boolean[]): number { let n = 0; for (let i = s.length - 1; i >= 0; i--) { if (marks[i & 1]) break; n = (n * 7 + s.charCodeAt(i)) | 0; } return n; }
function reads(s: string, marks: boolean[]): string { let out = ""; for (let i = 0; i < s.length && i < 60; i++) { if (marks[i]) break; out += s[i] + s.charCodeAt(i); } return out; }
function compares(s: string, marks: boolean[]): number { let n = 0; for (let i = 0; i < s.length; i++) { if (marks[i]) break; if (s[i] === "a") n++; if (s.startsWith("a", i)) n += 10; } return n; }

const none: boolean[] = []; for (let i = 0; i < 4096; i++) none.push(false);
const first = [true, ...none], third = none.slice(); third[2] = true;
let digest = 0;
const note = (value: unknown): void => { const text = String(value); for (let i = 0; i < text.length; i++) digest = (digest * 33 + text.charCodeAt(i)) | 0; };
for (let round = 0; round < 3; round++) {
  for (const marks of [none, first, third]) {
    digest = 0;
    for (const s of strings()) note(exitOnMark(s, marks));
    for (const s of strings()) note(onOneArm(s, marks));
    for (const s of strings()) note(nested([marks, none], s));
    for (const s of strings()) note(twoReads(s, marks));
    for (const s of strings()) note(fromBack(s, marks));
    for (const s of strings()) note(reads(s, marks));
    for (const s of strings()) note(compares(s, marks));
    for (const s of strings()) { note(exitOnMark(s, first)); note(exitOnMark(s, marks)); note(s.length); note(s.slice(0, 20)); }
    console.log(digest);
  }
  digest = 0;
  for (const s of strings()) note(exitOnElement(["stop", "b"], "stop", s));
  for (const s of strings()) note(exitOnElement(["a", "stop", "b"], "stop", s));
  for (const s of strings()) { note(exitOnCount(s, -1)); note(exitOnCount(s, 3)); note(exitOnCount(s, 1e9)); }
  for (const s of strings()) { note(exitOnStart(s, 0, 4)); note(exitOnStart(s, -1, 4)); note(exitOnStart(s, 1e6, 1e6 + 4)); }
  for (const s of strings()) { note(exitOnField(s, { done: true, n: 0 })); note(exitOnField(s, { done: false, n: 0 })); }
  for (const s of strings()) { note(exitOnCall(s, () => true)); note(exitOnCall(s, i => i > 10)); }
  for (const s of strings()) { note(throws(s, [null])); note(throws(s, ["a", "b", null])); note(throws(s, ["ab"])); }
  for (const s of strings()) note(tokens(s));
  console.log(digest);
}
