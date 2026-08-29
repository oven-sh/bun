// Regenerates the identifier tables at the bottom of
// src/bun_core/string/identifier.rs.
//
//   cd misctools && bun install && bun gen-unicode-table.ts
//
// Everything above the "auto-generated" marker in identifier.rs is kept as is.
// The script runs rustfmt on the result.
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { Context, Generator } from "./unicode-generator";

const UNICODE_VERSION = "16.0.0";

const OUTPUT = path.join(import.meta.dir, "..", "src", "bun_core", "string", "identifier.rs");
const MARKER = "// The remainder of this file is auto-generated. Do not edit.";

function generalCategory(name: string): number[] {
  return require(`@unicode/unicode-3.0.0/General_Category/${name}/code-points`);
}

// ES5 reference: https://es5.github.io/
//
// A conforming implementation of this International standard shall interpret
// characters in conformance with the Unicode Standard, Version 3.0 or later.
//
// UnicodeLetter: any character in the Unicode categories "Uppercase letter (Lu)",
// "Lowercase letter (Ll)", "Titlecase letter (Lt)", "Modifier letter (Lm)",
// "Other letter (Lo)", or "Letter number (Nl)".
//
// The "Letter number" category is left out because old versions of Safari did
// not accept it (https://github.com/evanw/esbuild/issues/1349). Names that
// contain one of these code points stay quoted so Safari can read them.
const idStartES5 = new Set<number>([
  ...generalCategory("Uppercase_Letter"),
  ...generalCategory("Lowercase_Letter"),
  ...generalCategory("Titlecase_Letter"),
  ...generalCategory("Modifier_Letter"),
  ...generalCategory("Other_Letter"),
]);

// UnicodeCombiningMark: "Non-spacing mark (Mn)" or "Combining spacing mark (Mc)"
// UnicodeDigit: "Decimal number (Nd)"
// UnicodeConnectorPunctuation: "Connector punctuation (Pc)"
const idContinueES5 = new Set<number>([
  ...idStartES5,
  ...generalCategory("Nonspacing_Mark"),
  ...generalCategory("Spacing_Mark"),
  ...generalCategory("Decimal_Number"),
  ...generalCategory("Connector_Punctuation"),
]);

// ESNext reference: https://tc39.es/ecma262/
//
// UnicodeIDStart: any Unicode code point with the Unicode property "ID_Start"
// UnicodeIDContinue: any Unicode code point with the Unicode property "ID_Continue"
const idStartESNext = new Set<number>(
  require(`@unicode/unicode-${UNICODE_VERSION}/Binary_Property/ID_Start/code-points`),
);
const idContinueESNext = new Set<number>(
  require(`@unicode/unicode-${UNICODE_VERSION}/Binary_Property/ID_Continue/code-points`),
);

// IdentifierPartChar also allows <ZWNJ> and <ZWJ> in every edition of the spec.
const ZWNJ = 0x200c;
const ZWJ = 0x200d;

// Unicode 4.1 through Unicode 15 omitted these two characters from ID_Continue
// by accident. Unicode 15.1 corrected this. A JS engine that uses an older
// Unicode version rejects them, so they stay out of the set that is valid in
// both ES5 and ESNext (the printer only unquotes names in that set). For more
// info see 2.2 in https://www.unicode.org/L2/L2023/23160-utc176-properties-recs.pdf
const ID_Continue_mistake = new Set<number>([0x30fb, 0xff65]);

const tables: { name: string; doc: string; check: (cp: number) => boolean }[] = [
  {
    name: "ID_START",
    doc: `ES5 \`UnicodeLetter\` (Unicode 3.0) or \`ID_Start\` in Unicode ${UNICODE_VERSION}.`,
    check: cp => idStartES5.has(cp) || idStartESNext.has(cp),
  },
  {
    name: "ID_CONTINUE",
    doc: `ES5 \`IdentifierPart\` (Unicode 3.0) or \`ID_Continue\` in Unicode ${UNICODE_VERSION}, plus ZWNJ and ZWJ.`,
    check: cp => idContinueES5.has(cp) || idContinueESNext.has(cp) || cp === ZWNJ || cp === ZWJ,
  },
  {
    name: "ID_START_ES5_AND_ES_NEXT",
    doc: `ES5 \`UnicodeLetter\` (Unicode 3.0) and \`ID_Start\` in Unicode ${UNICODE_VERSION}.`,
    check: cp => idStartES5.has(cp) && idStartESNext.has(cp),
  },
  {
    name: "ID_CONTINUE_ES5_AND_ES_NEXT",
    doc: `ES5 \`IdentifierPart\` (Unicode 3.0) and \`ID_Continue\` in Unicode ${UNICODE_VERSION}, plus ZWNJ and ZWJ, minus U+30FB and U+FF65.`,
    check: cp =>
      (idContinueES5.has(cp) && idContinueESNext.has(cp) && !ID_Continue_mistake.has(cp)) || cp === ZWNJ || cp === ZWJ,
  },
];

function bitsToU64Array(bits: number[]): bigint[] {
  const result: bigint[] = [];
  for (let i = 0; i < bits.length; i += 64) {
    let value = 0n;
    for (let j = 0; j < 64 && i + j < bits.length; j++) {
      if (bits[i + j]) {
        value |= 1n << BigInt(j);
      }
    }
    result.push(value);
  }
  return result;
}

async function generateTable(name: string, doc: string, check: (cp: number) => boolean): Promise<string> {
  const context: Context<boolean> = {
    get: (cp: number) => check(cp),
    eql: (a: boolean, b: boolean) => a === b,
  };

  // `stage3` is `[false, true]`, so every `stage2` entry is already the bit value.
  const generated = await new Generator(context).generate();
  if (generated.stage3.some(v => typeof v !== "boolean")) {
    throw new Error("unexpected stage3 element");
  }
  const stage2 = generated.stage2.map(idx => (generated.stage3[idx] ? 1 : 0));

  return `
/// ${doc}
pub(super) static ${name}: Table = Table {
    stage1: &[${generated.stage1.join(",")}],
    stage2: &[${bitsToU64Array(stage2).join(",")}],
};
`;
}

async function main() {
  const existing = readFileSync(OUTPUT, "utf8");
  const markerIndex = existing.indexOf(MARKER);
  if (markerIndex === -1) {
    throw new Error(`marker not found in ${OUTPUT}: ${MARKER}`);
  }
  const head = existing.slice(0, existing.lastIndexOf("\n", markerIndex) + 1);

  const generated: string[] = [];
  for (const { name, doc, check } of tables) {
    generated.push(await generateTable(name, doc, check));
  }

  const output = `${head}${MARKER}
// Generated by misctools/gen-unicode-table.ts from Unicode ${UNICODE_VERSION}.
// ──────────────────────────────────────────────────────────────────────────

mod tables {
    /// Two-stage bitset over \`0..=0x10FFFF\`: \`stage1[cp >> 8]\` is the bit offset
    /// of the 256-bit block that holds \`cp\`, \`stage2\` is the packed bit array.
    pub(super) struct Table {
        pub(super) stage1: &'static [u16],
        pub(super) stage2: &'static [u64],
    }

    impl Table {
        /// \`cp\` must be \`<= 0x10FFFF\`. A larger value indexes past \`stage1\`
        /// and panics.
        #[inline]
        pub(super) fn contains(&self, cp: u32) -> bool {
            let bit_pos = u32::from(self.stage1[(cp >> 8) as usize]) + (cp & 0xFF);
            (self.stage2[(bit_pos >> 6) as usize] & (1u64 << (bit_pos & 63))) != 0
        }
    }
${generated.join("")}}
`;

  writeFileSync(OUTPUT, output);

  const fmt = Bun.spawnSync(["rustfmt", "--edition", "2024", OUTPUT], {
    stdio: ["inherit", "inherit", "inherit"],
  });
  if (fmt.exitCode !== 0) {
    throw new Error(`rustfmt exited with ${fmt.exitCode}`);
  }
  console.log(`wrote ${OUTPUT}`);
}

await main();
