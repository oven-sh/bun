import { Generator, Context } from "./unicode-generator";

// Create sets for fast lookups
const idStartES5Set = new Set([
  ...require("@unicode/unicode-3.0.0/General_Category/Uppercase_Letter/code-points"),
  ...require("@unicode/unicode-3.0.0/General_Category/Lowercase_Letter/code-points"),
  ...require("@unicode/unicode-3.0.0/General_Category/Titlecase_Letter/code-points"),
  ...require("@unicode/unicode-3.0.0/General_Category/Modifier_Letter/code-points"),
  ...require("@unicode/unicode-3.0.0/General_Category/Other_Letter/code-points"),
]);

const idContinueES5Set = new Set([
  ...idStartES5Set,
  ...require("@unicode/unicode-3.0.0/General_Category/Nonspacing_Mark/code-points"),
  ...require("@unicode/unicode-3.0.0/General_Category/Spacing_Mark/code-points"),
  ...require("@unicode/unicode-3.0.0/General_Category/Decimal_Number/code-points"),
  ...require("@unicode/unicode-3.0.0/General_Category/Connector_Punctuation/code-points"),
]);

const idStartESNextSet = new Set(require("@unicode/unicode-15.1.0/Binary_Property/ID_Start/code-points"));
const idContinueESNextSet = new Set(require("@unicode/unicode-15.1.0/Binary_Property/ID_Continue/code-points"));

// Exclude known problematic codepoints
const ID_Continue_mistake = new Set([0x30fb, 0xff65]);

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

async function generateTable(table: string, name: string, checkFn: (cp: number) => boolean) {
  const context: Context<boolean> = {
    get: (cp: number) => checkFn(cp),
    eql: (a: boolean, b: boolean) => a === b,
  };

  const generator = new Generator(context);
  const tables = await generator.generate();

  return `
pub fn ${name}(cp: u21) bool {
    if (cp > 0x10FFFF) return false;
    const high = cp >> 8;
    const low = cp & 0xFF;
    const stage2_idx = ${table}.stage1[high];
    const bit_pos = stage2_idx + low;
    const u64_idx = bit_pos >> 6;
    const bit_idx = @as(u6, @intCast(bit_pos & 63));
    return (${table}.stage2[u64_idx] & (@as(u64, 1) << bit_idx)) != 0;
}
const ${table} = struct {
    pub const stage1 = [_]u16{${tables.stage1.join(",")}};
    pub const stage2 = [_]u64{${bitsToU64Array(tables.stage2)
      .map(n => n.toString())
      .join(",")}};
};

`;
}

async function main() {
  const functions = [
    {
      name: "isIDStartES5",
      table: "idStartES5",
      check: (cp: number) => idStartES5Set.has(cp),
    },
    {
      name: "isIDContinueES5",
      table: "idContinueES5",
      check: (cp: number) => idContinueES5Set.has(cp),
    },
    {
      name: "isIDStartESNext",
      table: "idStartESNext",
      check: (cp: number) => idStartESNextSet.has(cp),
    },
    {
      name: "isIDContinueESNext",
      table: "idContinueESNext",
      check: (cp: number) => idContinueESNextSet.has(cp) && !ID_Continue_mistake.has(cp),
    },
  ];

  const results = await Promise.all(
    functions.map(async ({ name, check, table }) => {
      const code = await generateTable(table, name, check);
      return `
/// ${name} checks if a codepoint is valid in the ${name} category
${code}`;
    }),
  );

  console.log(`/// This file is auto-generated. Do not edit.

${results.join("\n\n")}`);
}

main();
