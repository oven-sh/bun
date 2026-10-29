// A string grows piece by piece in a loop, and the pieces are appended on more than one path: in both arms of a test, in a try and in its
// handler, behind a continue, in an inner and an outer loop. A program draws where the string lives, the loop, one to three nested shapes of
// paths, what the pieces are (some throw in the middle of an append, some are not Latin-1, some are no strings) and how many turns there are.
// One program in eight takes a million turns: an append that costs the length of the string then takes minutes, not a second.
import type { Random } from "./random";

const homes = {
  "a-local": { before: 'let t = "";', name: "t", after: "" },
  "a-field": { before: 'const o = { t: "" };', name: "o.t", after: "" },
  "a-captured-local": { before: 'let t = ""; const read = () => t;', name: "t", after: "note(read().length);" },
  "a-module-variable": { before: 'outer = "";', name: "outer", after: "" },
  "an-element": { before: 'const list = [""];', name: "list[0]", after: "" },
};

const loops = {
  "counted": "for (let j = 0; j < turns; j++) { BODY }",
  "counted-down": "for (let j = turns - 1; j >= 0; j--) { BODY }",
  "while": "let j = -1; while (++j < turns) { BODY }",
  "do-while": "let j = 0; do { BODY } while (++j < turns);",
  "for-of": "for (const j of numbers(turns)) { BODY }",
  "for-each": "numbers(turns).forEach(j => { BODY });",
  "two-deep":
    "for (let i = 0; i < turns; i += 8) { T += PIECE0; for (let j = i; j < i + 8 && j < turns; j++) { BODY } }",
  "a-try-around": 'try { for (let j = 0; j < turns; j++) { BODY } } catch (e) { T += "left:" + name(e); }',
};

// STEP is a nested shape or an append.
const shapes = [
  "STEP",
  "if (j & 1) { STEP } else { STEP }",
  "STEP if (j % 3 === 0) { STEP }",
  'try { STEP } catch (e) { T += "T"; }',
  "try { STEP } catch (e) { T += name(e); }",
  "try { STEP } catch (e) { note(T.length); }",
  "try { STEP } catch (e) { }",
  "try { STEP } finally { STEP }",
  'try { STEP } catch (e) { T += "c"; } finally { T += "f"; }',
  'try { try { STEP } finally { T += "i"; } } catch (e) { T += "o"; }',
  "switch (j & 3) { case 0: STEP break; case 1: STEP case 2: STEP break; default: STEP }",
  'T = j & 1 ? T + PIECE : T + PIECE + ";";',
  "T = PIECE + T;",
  "T = `${T}${PIECE}`;",
  "T = T.concat(PIECE);",
  "T += T.length;",
  "{ const before = T; STEP if (j === 7) note(before.length); }",
  "if (j % 1000 === 999) note(T.charCodeAt(T.length - 1)); STEP",
];

const pieces = [
  '"n;"',
  '""',
  "j",
  '"n" + j + ";"',
  "String(j)",
  "(j + 0.5)",
  "texts[j & 3]",
  "JSON.stringify(things[j & 3])",
  "may(j, 0)",
  "may(j, 100)",
  "may(j, 3)",
  '"a" + may(j, 50) + "b"',
  '(j === wide ? "\\u4e16" : "x")',
  "(j % 7 ? null : undefined)",
  '(j % 997 === 5 ? Symbol("s") : "y")',
  "talks",
  "10n",
  "[j, j]",
];

const head = `let outer = "";
const noted = [];
function note(v) { if (noted.length < 40) noted.push(v); }
function name(e) { return e instanceof Error ? e.constructor.name : typeof e; }
function numbers(n) { return Array.from({ length: n }, (_, i) => i); }
function may(j, every) { if (every && j % every === every - 1) throw new RangeError("may " + j); return "m" + (j & 15); }
function hash(t) { let h = 0; for (let i = 0; i < t.length; i++) h = (Math.imul(h, 31) + t.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
const texts = ["", "one", "tw\\u00f6", "three three three"];
const things = [1, "two", { three: 3 }, [4, null]];
let asked = 0;
const talks = { toString() { asked++; if (asked % 400 === 399) throw new TypeError("talks"); return "<" + (asked & 7) + ">"; } };`;

export function generate(random: Random): string {
  const home = random.pick(Object.values(homes));
  const append = () => (random.chance(0.8) ? "T += PIECE;" : "T = T + PIECE;");
  const shape = (depth: number): string =>
    random.pick(shapes).replace(/STEP/g, () => (depth > 0 && random.chance(0.35) ? shape(depth - 1) : append()));
  // One program in four is nothing but an append in a try and another in its handler, a million times.
  const isPlainHandler = random.chance(0.25);
  const turns = isPlainHandler
    ? 1000000
    : random.weighted([
        [1, 3],
        [2, 40],
        [3, 3000],
        [1, 200000],
        [1, 1000000],
      ] as const);
  const body = isPlainHandler
    ? random.pick(shapes.slice(3, 5)).replace(/STEP/g, append)
    : (random.chance(0.3) ? 'if (j % 5 === 4) { T += "five"; continue; } ' : "") + shape(2);
  let loop = random.pick(Object.values(loops));
  if (loop.includes("forEach")) loop = loop.replace("BODY", () => body.replace(/continue;/g, "return;"));
  const text = loop
    .replace("BODY", () => body)
    .replace("PIECE0", () => random.pick(pieces.slice(0, 8)))
    .replace(/PIECE/g, () => random.pick(pieces))
    .replace(/\bT\b/g, home.name);
  return `${head}
const wide = ${random.pick([-1, 0, 20, 2500])};
function grow(turns) {
  ${home.before}
  ${text}
  ${home.after}
  return ${home.name};
}
for (let round = 0; round < 2; round++) {
  let t;
  try { t = grow(${turns}); } catch (e) { t = "thrown: " + name(e); }
  console.log(typeof t, t.length, hash(t), JSON.stringify(t.slice(0, 40)), JSON.stringify(t.slice(-40)));
}
console.log(noted.join(" "), asked);
`;
}
