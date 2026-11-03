// Patterns built at run time whose matches need more frames than the flat program may allocate, so the bytecode interpreter finishes the match. The .json lowers the limit to 4096 frames.
// What native code hands back is unknown to the compiler. A text that it can predict gets its code in the image and never comes here: `Date.now() < 0 ? "x" : ""` and `process.argv[2] ?? ""` are predicted.
// Env: BUN_JSC_maxRegExpStackSize=65536
const tail: string = new CustomEvent("tail", { detail: "" }).detail;
const maxFrames = 65536 / 16;

const groups: [string, string][] = [
  ["x(?:ab)*", "ab"],
  ["x(?:ab)+", "ab"],
  ["x(?:ab|cd)*", "cd"],
  ["x(?:[ab]c)*", "bc"],
  ["x(?:Жb)*", "Жb"],
];

for (const [text, iteration] of groups) {
  const expression = new RegExp(text + tail);
  for (const iterations of [1, maxFrames - 1, maxFrames, 3 * maxFrames, 2]) {
    for (const prefix of ["", "yy", "Ж"]) {
      const match = expression.exec(prefix + "x" + iteration.repeat(iterations) + "a");
      console.log(`${expression} ${iterations} ${prefix.length}: ${match?.index} ${match?.[0].length}`);
    }
  }
}

export {};
