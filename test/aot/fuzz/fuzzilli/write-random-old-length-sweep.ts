// Generates random programs on lists whose length is read in front of a write: the old length is then a position and a bound. Writes convert the storage, push, pop, set the length, splice, delete, freeze and hand the list to a function.
// The program number is the random seed.
//
//   bun write-random-old-length-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<functions>-functions.ts
//   bun write-random-old-length-sweep.ts count
import { Draws, writePrograms } from "./draw-by-seed.ts";

const lists = ["[1, 2, 3, 4, 5]", "[1.5, 2.5, 3.5]", '["a", "b", "c", "d"]', '[1, "x", 3]', "[1, , 3, 4]", "[]", "Array.from({ length: n0 }, (_, i) => i)", "new Array(n0).fill(0)", "new Array(n0)", '[..."hello"]', "[{ a: 1 }, { a: 2 }]", "[true, false, true]", "[n0, n0 + 1, n0 + 2]", "Array.of(7, 8, 9)", "[-0, NaN, 1e300]"]; // prettier-ignore
const writes = ["a[0] = 0.5", 'a[1] = "s" as any', "a[0] = { z: 1 } as any", "a.push(9)", "a.push(1, 2, 3)", "a.push(0.25)", "a.pop()", "a.shift()", "a.unshift(8)", "a.length = 2", "a.length = old + 3", "a.length = 0", "a.splice(1, 1)", "a.splice(1, 0, 5, 6)", "a.reverse()", "a.sort()", "delete a[1]", "a.fill(3)", "a[old] = 4", "a[old + 2] = 4", "a[old] = 0.75", 'a[old] = "t" as any', "poke(a)", "poke2(a, k)", "a.copyWithin(0, 1)", "a[a.length] = 1.5", "a[k] = 2.5", "Object.freeze(a)", "a.concat([1])", "[a[0], a[1]] = [a[1], a[0]]", "a.at(-1)", ""]; // prettier-ignore
const reads = ["a[old]", "a[old - 1]", "a[old + 1]", "a[old >> 1]", "a[k]", "a[old - k]", "a[a.length - 1]", "a[now - 1]", "a[now]", "a[Math.min(old, now) - 1]", "a.at(old)", "a[old | 0]", "a[old >>> 0]"]; // prettier-ignore
const questions = ["old < a.length", "old < now", "old <= now", "old <= a.length", "k < old", "k < now", "k < a.length && old < a.length", "old - 1 < a.length", "now > old", "a.length > old", "old !== now", "old > 0 && old - 1 < now", "old in a", "Object.hasOwn(a, old)", "old >= 0", "a.length >= old", "k <= old && old < a.length"]; // prettier-ignore
const loops = ["for (let i = 0; i < old; i++) { B }", "for (let i = old; i < a.length; i++) { B }", "for (let i = old - 1; i >= 0; i--) { B }", "for (let i = 0, e = old; i < e; i++) { B }", "for (let i = 0; i < Math.min(old, a.length); i++) { B }", "let i = 0; while (i < old && i < a.length) { B; i++; }", "for (let i = 0; i <= old && i < a.length; i++) { B }", "for (let i = old; i-- > 0;) { B }"]; // prettier-ignore

// `B` is what a loop does in a turn.
function write(seed: number): { name: string; text: string } {
  const draws = new Draws(seed);
  const { next, pick, between } = draws;
  const deed = () => pick(writes) + ";";
  function writeFunction(at: number): string {
    const type = pick(["number[]", "any[]", "any", "(number | string)[]", "Array<any>", "any[]"]);
    const lines = [
      "  let s: any = 0;",
      '  const note = (v: any) => {\n    s = typeof s === "number" && typeof v === "number" ? s * 0.5 + v : String(s) + "," + String(v && typeof v === "object" ? JSON.stringify(v) : v);\n  };',
      "  const old = a.length;",
      "  " + deed(),
      "  const now = a.length;",
    ]; // prettier-ignore
    for (let left = between(1, 3); left > 0; left--) {
      const drawn = next();
      if (drawn < 0.35)
        lines.push(`  if (${pick(questions)}) {\n    ${next() < 0.5 ? deed() : ""}\n    note(${pick(reads)});\n    ${next() < 0.5 ? `note(${pick(reads)});` : ""}\n  }`); // prettier-ignore
      else if (drawn < 0.75) {
        const turn = pick([
          "note(a[i]);",
          "note(a[i]);\n" + deed(),
          "if (i < now) note(a[i]);",
          "if (old < a.length) note(a[old]);\nnote(a[i]);",
          "a[i] = (a[i] as any) + 1;",
          `if (i === k) {\n${deed()}\n}\nnote(a[i]);`,
          "note(a[old - 1 - i]);",
          "if (i < a.length) note(a[i]);\nelse note(i);",
          `if (${pick(questions)}) note(${pick(reads)});`,
        ]);
        // A loop that grows its own bound ends.
        const guard = "if (s !== s && i > 60) break;\nif (a.length > 200) break;\n";
        lines.push(`  {\n    ${pick(loops).replace("B", () => "\n" + guard + turn + "\n")}\n  }`);
      } else lines.push(`  ${deed()}\n  note(${pick(reads)});`);
    }
    return `function f${at}(a: ${type}, k: number): any {\n${lines.join("\n")}\n  return [s, a.length, old, now, JSON.stringify(a)];\n}`;
  }
  const functions = draws.several(4, writeFunction);
  const list = () => pick(lists);
  const lines = [
    "function poke(a: any) {\n  a[0] = 1.25;\n}",
    "function poke2(a: any, k: number) {\n  if (k > 1) a.push(k);\n  else a.length = Math.max(0, a.length - 1);\n}",
    `let n0 = ${between(0, 6)};`,
    "const show = (ask: () => any) => {\n  try {\n    console.log(String(ask()));\n  } catch (error: any) {\n    console.log(error?.constructor?.name, String(error?.message).slice(0, 60));\n  }\n};",
    ...functions,
    ...functions.flatMap((_, at) => [
      ...draws.several(between(2, 5), () => `show(() => f${at}(${list()} as any, ${pick(["0", "1", "2", "3", "n0", "5", "-1", "1.5"])}));`),
      ...(next() < 0.4 ? [`for (let r = 0; r < 4; r++) show(() => f${at}(${list()} as any, r));`] : []),
    ]),
    "export {};",
  ]; // prettier-ignore
  return { name: `${functions.length}-functions.ts`, text: lines.join("\n") + "\n" };
}

writePrograms(8_000_000, write);
