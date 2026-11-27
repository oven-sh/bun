// Generates unicode_tables.rs from the behavior of the Node.js that runs it.

import assert from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";

const ported = readFileSync(new URL("lib.rs", import.meta.url), "utf8").match(/node\/blob\/(v[\d.]+)\//)[1];
assert(!process.versions.bun && process.version === ported, `run this with Node.js ${ported}`);

const END = 0x110000;
const { fromCodePoint } = String;
const hex = value => "0x" + value.toString(16).toUpperCase();

// A code point gets the first that matches, so "RemainingLetter" is L without Lu and Ll.
const categories = Object.entries({
  UppercaseLetter: /^\p{Lu}$/u,
  LowercaseLetter: /^\p{Ll}$/u,
  RemainingLetter: /^\p{L}$/u,
  LetterNumber: /^\p{Nl}$/u,
  DecimalNumber: /^\p{Nd}$/u,
  SpaceSeparator: /^\p{Zs}$/u,
  RemainingSeparator: /^\p{Z}$/u,
  Control: /^\p{Cc}$/u,
  RemainingOther: /^\p{C}$/u,
  ConnectorPunctuation: /^\p{Pc}$/u,
  RemainingPunctuation: /^\p{P}$/u,
  Unlisted: /^/,
});
const categoryNames = categories.map(([name]) => name);
const categoryOf = c => categories.findIndex(([, regExp]) => regExp.test(fromCodePoint(c)));

const sigmaContexts = ["Other", "Cased", "CaseIgnorable"];
const [OTHER, CASED, CASE_IGNORABLE] = sigmaContexts.keys();
const endsInFinalSigma = string => string.toLowerCase().endsWith("ς");
const sigmaContextOf = c =>
  endsInFinalSigma(fromCodePoint(c) + "Σ")
    ? CASED
    : endsInFinalSigma("a" + fromCodePoint(c) + "Σ")
      ? CASE_IGNORABLE
      : OTHER;

const PROPERTY_BITS = 8;
const CATEGORY_BITS = 4;
const ALTERNATING_CASE = categories.length;
const pack = (category, sigmaContext) => category | (sigmaContext << CATEGORY_BITS);
const UPPER = pack(categoryNames.indexOf("UppercaseLetter"), CASED);
const LOWER = pack(categoryNames.indexOf("LowercaseLetter"), CASED);
assert(ALTERNATING_CASE < 1 << CATEGORY_BITS && sigmaContexts.length <= 1 << (PROPERTY_BITS - CATEGORY_BITS));

const properties = new Uint8Array(END);
for (let c = 0; c < END; c++) {
  const sigmaContext = sigmaContextOf(c);
  const sigmaBefore = suffix => ("aΣ" + suffix).toLowerCase()[1];
  assert.equal(sigmaBefore(fromCodePoint(c)) === "σ", sigmaContext === CASED);
  assert.equal(sigmaBefore(fromCodePoint(c) + "a") === "σ", sigmaContext !== OTHER);
  properties[c] = pack(categoryOf(c), sigmaContext);
}
const propertyRuns = [];
for (let c = 0; c < END;) {
  let end = c;
  while (properties[end] === ((end - c) % 2 ? LOWER : UPPER)) end++;
  const alternates = end - c > 2 && !(c > 0 && properties[c - 1] === UPPER);
  if (!alternates) for (end = c; properties[end] === properties[c];) end++;
  propertyRuns.push((c << PROPERTY_BITS) | (alternates ? pack(ALTERNATING_CASE, CASED) : properties[c]));
  c = end;
}

const lower = new Map();
for (let c = 0; c < END; c++) {
  const to = fromCodePoint(c).toLowerCase();
  if (c === 0x130) assert.equal(to, "i̇");
  else if (to !== fromCodePoint(c)) {
    assert.equal(to.length, fromCodePoint(c).length);
    assert.equal([...to].length, 1);
    lower.set(c, to.codePointAt(0));
  }
}

/** Maps each code point to the next one that it matches under `flags`, and the last back to the first. */
function caseOrbits(flags, end) {
  const escape = c => (flags.includes("u") ? `\\u{${c.toString(16)}}` : "\\u" + c.toString(16).padStart(4, "0"));
  const isSurrogate = c => c >= 0xd800 && c <= 0xdfff;
  const cased = new Set();
  for (let c = 0; c < end; c++) {
    for (const other of [fromCodePoint(c).toLowerCase(), fromCodePoint(c).toUpperCase()]) {
      if (other === fromCodePoint(c)) continue;
      cased.add(c);
      if ([...other].length === 1) cased.add(other.codePointAt(0));
    }
  }
  const all = [...cased].map(c => fromCodePoint(c)).join("");
  const next = new Map();
  for (const c of cased) {
    const same = all
      .match(new RegExp(`[${escape(c)}]`, "g" + flags))
      .map(it => it.codePointAt(0))
      .sort((a, b) => a - b);
    assert.deepEqual(all.match(new RegExp(escape(c), "g" + flags)).length, same.length);
    if (same.length > 1) next.set(c, same[(same.indexOf(c) + 1) % same.length]);
  }
  assert.deepEqual(new Set(next.values()), new Set(next.keys()), "following `next` has to lead back to the start");
  // Nothing outside `cased` matches another code point: any two differ in a bit, or in whether they are in `cased`.
  const assertDisjoint = isInside => {
    let source = "";
    let outside = "";
    for (let c = 0, start = -1; c <= end; c++) {
      const side = c < end && !isSurrogate(c) ? isInside(c) : undefined;
      if (side === true && start < 0) start = c;
      if (side !== true && start >= 0) {
        source += escape(start) + "-" + escape(c - 1);
        start = -1;
      }
      if (side === false) outside += fromCodePoint(c);
    }
    assert(!new RegExp(`[${source}]`, flags).test(outside));
  };
  assertDisjoint(c => cased.has(c));
  assertDisjoint(c => !cased.has(c));
  for (let bit = 1; bit < end; bit *= 2) assertDisjoint(c => (cased.has(c) ? undefined : (c & bit) !== 0));
  return next;
}

const CASE_BLOCK_BITS = 6;
const caseDeltas = new Map();
const caseBlocks = new Map();
const intern = (map, key) => map.getOrInsert(key, map.size);

/** Up to the last block that `map` has a code point in. */
function caseBlockNumbers(map) {
  const deltaOf = c => intern(caseDeltas, (map.get(c) ?? c) - c);
  return Array.from({ length: (Math.max(...map.keys()) >> CASE_BLOCK_BITS) + 1 }, (_, block) => {
    const deltas = Array.from({ length: 1 << CASE_BLOCK_BITS }, (_, i) => deltaOf((block << CASE_BLOCK_BITS) + i));
    return intern(caseBlocks, deltas.join());
  });
}

const out = [
  `//! Generated by generate_unicode_tables.mjs with Node.js ${process.version}, which has Unicode ${process.versions.unicode}. Do not edit.`,
  "",
];

function emitEnum(name, tableName, variants) {
  out.push("#[derive(Clone, Copy)]", `pub(crate) enum ${name} {`, ...variants.map(it => `    ${it},`), "}", "");
  out.push(`pub(crate) const ${tableName}: [${name}; ${variants.length}] = [`);
  out.push(...variants.map(it => `    ${name}::${it},`), "];", "");
}

function emitTable(doc, name, type, values) {
  out.push(`/// ${doc}`, "#[rustfmt::skip]", `pub(crate) static ${name}: &[${type}] = &[`);
  let line = "   ";
  for (const value of values) {
    if (line.length + value.length + 2 > 120) {
      out.push(line);
      line = "   ";
    }
    line += ` ${value},`;
  }
  out.push(line, "];", "");
}

const emitCaseMap = (doc, name, map) => emitTable(doc, name, "u8", caseBlockNumbers(map).map(String));

emitEnum("Category", "CATEGORIES", categoryNames);
emitEnum("SigmaContext", "SIGMA_CONTEXTS", sigmaContexts);
out.push(
  `pub(crate) const PROPERTY_BITS: u32 = ${PROPERTY_BITS};`,
  `pub(crate) const CATEGORY_BITS: u32 = ${CATEGORY_BITS};`,
  "/// In place of an index into [`CATEGORIES`]: upper and lower case alternate.",
  `pub(crate) const ALTERNATING_CASE: usize = ${ALTERNATING_CASE};`,
  "/// A case map has the number of a block of [`CASE_BLOCKS`] for each block of code points.",
  `pub(crate) const CASE_BLOCK_LEN: usize = ${1 << CASE_BLOCK_BITS};`,
  "",
);
emitTable(
  "`first << PROPERTY_BITS | sigma_context << CATEGORY_BITS | category`, up to the next `first`.",
  "PROPERTY_RUNS",
  "u32",
  propertyRuns.map(hex),
);
emitCaseMap("`toLowerCase()` of one code point, except U+0130.", "LOWER_CASE", lower);
emitCaseMap("The next code point that matches under `/i`.", "NEXT_CASE_VARIANT", caseOrbits("i", 0x10000));
emitCaseMap("The next code point that matches under `/iu`.", "NEXT_CASE_VARIANT_UNICODE", caseOrbits("iu", END));
emitTable(
  "An index into [`CASE_DELTAS`] for each code point of each block.",
  "CASE_BLOCKS",
  "u8",
  [...caseBlocks.keys()].flatMap(deltas => deltas.split(",")),
);
emitTable("What to add to a code point.", "CASE_DELTAS", "i32", [...caseDeltas.keys()].map(String));

writeFileSync(new URL("unicode_tables.rs", import.meta.url), out.join("\n"));
