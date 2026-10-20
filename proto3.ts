import { cssInternals } from "bun:internal-for-testing";
const minify_test_output = (css: string, targets: any) => cssInternals.minifyTest(css, "", targets);
const defaults = { chrome: 80 << 16, edge: 80 << 16, firefox: 78 << 16, safari: 14 << 16, opera: 67 << 16 };
const T0 = performance.now();
let lastLap = T0;
const lap = (name: string) => {
  const now = performance.now();
  console.log(name.padEnd(20), (now - lastLap).toFixed(0), "ms");
  lastLap = now;
};

// A declaration as numbers: the values that it sets (four bits each) and the mask of those values.
type Declaration = {
  prefixed: boolean;
  all: boolean;
  // In a browser that reads all of the declaration.
  mask: number;
  bits: number;
  // In the third kind of browser of `expectSameValues`. A mask of 0: that browser drops the declaration.
  nativeMask: number;
  nativeBits: number;
};
// The initial values are 0, as a value that no declaration sets.
const valueIds = new Map<string, number>([["none", 0], ["solid", 0], ["currentcolor", 0], ["auto", 0], ["unset", 0]]);

// Checks the values that three kinds of browser apply, for every block of up to four of `atoms`.
const expectSameValues = (
  atoms: string[],
  // The values that a declaration sets. `undefined` is a value that it does not set.
  longhands: (name: string, words: string[]) => (string | undefined)[],
  // The first kind of browser reads the unprefixed names, and the second kind reads every name. This gives the values that the third kind reads.
  native: (name: string, prefixed: boolean, words: string[], values: (string | undefined)[]) => (string | undefined)[],
) => {
  const pack = (values: (string | undefined)[]) => {
    let mask = 0;
    let bits = 0;
    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      if (value === undefined) continue;
      if (!valueIds.has(value)) valueIds.set(value, valueIds.size);
      mask |= 15 << (4 * i);
      bits |= valueIds.get(value)! << (4 * i);
    }
    return { mask, bits };
  };
  const parsed = new Map<string, Declaration>();
  const parse = (text: string) => {
    let declaration = parsed.get(text);
    if (declaration) return declaration;
    const colon = text.indexOf(":");
    const prefixed = text.startsWith("-webkit-");
    const name = text.slice(prefixed ? 8 : 0, colon);
    const words = text.slice(colon + 1).split(" ");
    // `all` sets every value, and `cursor` is the fourth one.
    const values = name === "all" ? ["unset", "unset", "unset", "unset"] : name === "cursor" ? [, , , words[0]] : longhands(name, words);
    const { mask, bits } = pack(values);
    const read = name === "all" || name === "cursor" ? { mask, bits } : pack(native(name, prefixed, words, values));
    declaration = { prefixed, all: name === "all", mask, bits, nativeMask: read.mask, nativeBits: read.bits };
    parsed.set(text, declaration);
    return declaration;
  };

  // Every block of up to four of the atoms, with the values that each kind of browser has to apply after it.
  // The third kind has to get every unprefixed declaration in full, until the block has a prefixed name.
  type Block = { parent?: Block; text: string; applied: number[]; written: boolean; plain: boolean };
  const declarations = atoms.map(parse);
  const blocks: Block[] = [];
  let sheet = "";
  // The second sheet has each block after a rule that Bun merges it into, or as two rules that Bun merges.
  let merged = "";
  let last: Block[] = [{ text: "", applied: [0, 0, 0], written: false, plain: true }];
  for (let length = 1; length <= 4; length++) {
    const next: Block[] = [];
    for (let b = 0; b < last.length; b++) {
      const parent = last[b];
      for (let atom = 0; atom < atoms.length; atom++) {
        const declaration = declarations[atom];
        const full = declaration.prefixed || !parent.written;
        const block: Block = {
          parent,
          text: parent.text + atoms[atom] + ";",
          applied: [
            declaration.prefixed ? parent.applied[0] : (parent.applied[0] & ~declaration.mask) | declaration.bits,
            (parent.applied[1] & ~declaration.mask) | declaration.bits,
            full
              ? (parent.applied[2] & ~declaration.mask) | declaration.bits
              : (parent.applied[2] & ~declaration.nativeMask) | declaration.nativeBits,
          ],
          written: !declaration.all && (parent.written || declaration.prefixed),
          plain: parent.plain && !declaration.prefixed,
        };
        const selector = ".r" + blocks.length + "{";
        sheet += selector + block.text + "}\n";
        // Each of two rules gets its prefixes alone, so only a block with no prefixed name is in the sheet as two rules.
        const first = !block.plain || length === 1 ? "--z:1" : (length === 2 ? parent : parent.parent!).text;
        merged += selector + first + "}" + selector + (first === "--z:1" ? block.text : block.text.slice(first.length)) + "}\n";
        next.push(block);
        blocks.push(block);
      }
    }
    last = next;
  }
  lap("sheets");
  const output = minify_test_output(sheet, defaults);
  lap("prefix");
  // Bun minifies a rule again after it merges a rule into it. That pass gives the same sheet.
  const second = minify_test_output(merged, defaults).replaceAll("--z:1;", "");
  lap("prefix2");
  const stable = second === output;

  const wrong: string[] = [];
  const rules = output.split("}");
  for (let i = 0; i < blocks.length; i++) {
    const rule = rules[i];
    const printed = rule.slice(rule.indexOf("{") + 1).split(";");
    let unprefixed = 0;
    let both = 0;
    let third = 0;
    for (let d = 0; d < printed.length; d++) {
      const declaration = parse(printed[d]);
      if (!declaration.prefixed) unprefixed = (unprefixed & ~declaration.mask) | declaration.bits;
      both = (both & ~declaration.mask) | declaration.bits;
      third = (third & ~declaration.nativeMask) | declaration.nativeBits;
    }
    const applied = blocks[i].applied;
    if (unprefixed !== applied[0] || both !== applied[1] || third !== applied[2]) wrong.push(blocks[i].text);
  }
  lap("check");
  return { count: blocks.length, rules: rules.length, wrong, stable };
};

{
  const r = expectSameValues(
    [
      "text-decoration:underline",
      "text-decoration:underline dotted",
      "-webkit-text-decoration:overline wavy",
      "text-decoration-color:red",
      "all:unset",
      "cursor:pointer",
    ],
    (name, words) =>
      name === "text-decoration"
        ? [
            words[0],
            words.find(word => word === "dotted" || word === "wavy") ?? "solid",
            words.find(word => word === "red") ?? "currentcolor",
          ]
        : [undefined, undefined, words[0]],
    // Safari 14 reads the prefixed shorthand and the unprefixed longhands. Its unprefixed shorthand is the line alone, and it drops any other value.
    (name, prefixed, words, values) =>
      prefixed || name !== "text-decoration" ? values : words.length === 1 ? [values[0]] : [],
  );
  console.log("decoration", r.count, r.rules, r.wrong.length, r.stable, r.wrong.slice(0, 8));
}
{
  const r = expectSameValues(
    [
      "text-emphasis:dot",
      "text-emphasis:circle red",
      "-webkit-text-emphasis:circle red",
      "text-emphasis:var(--v)",
      "text-emphasis-color:red",
      "all:unset",
    ],
    (name, words) =>
      name === "text-emphasis-color"
        ? [undefined, words[0]]
        : words[0] === "var(--v)"
          ? [words[0], words[0]]
          : [
              words.find(word => word === "dot" || word === "circle") ?? "none",
              words.find(word => word === "red") ?? "currentcolor",
            ],
    // Chrome 80 reads only the prefixed names of this family.
    (name, prefixed, words, values) => (prefixed ? values : []),
  );
  console.log("emphasis", r.count, r.rules, r.wrong.length, r.stable, r.wrong.slice(0, 8));
}
console.log("total", (performance.now() - T0).toFixed(0), "ms");
