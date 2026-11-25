// Every way in which a function takes what a generator yields, times how the generator makes it, times how the function is called.
//
//   bun write-walk-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<producer>--<first>--<consumer>--<turn>--<caller>--<mark>--<language>.<mjs|cjs>
//   bun write-walk-sweep.ts count
//   bun write-walk-sweep.ts named <pattern> <folder> [most]
//
// A compiler that knows which generator a loop walks lays the body of the generator into the loop. Where the function with that loop is itself copied into its caller, and the generator walks another generator,
// three bodies stand in one. A build died there on a right program: a loop at the top of a CommonJS file called the function, and made the generator once more beside the call.
import { mkdirSync, writeFileSync } from "node:fs";

const counted = (name: string) => `function* ${name}(count) { FIRST for (let k = 0; k < count; k++) yield k; }`;
const producers: [name: string, text: string][] = [
  ["counted", counted("items")],
  ["handed-on-from-a-list", "function* items(count) { FIRST yield* [0, 1, 2, 3].slice(0, count); }"],
  ["with-a-finally", "function* items(count) { FIRST try { for (let k = 0; k < count; k++) yield k; } finally { closed++; } }"],
  ["through-another-by-a-loop", `${counted("inner")}\nfunction* items(count) { for (const value of inner(count)) yield value; }`],
  ["through-another-handed-on", `${counted("inner")}\nfunction* items(count) { yield* inner(count); }`],
  ["through-two-others", `${counted("inner")}\nfunction* middle(count) { for (const value of inner(count)) yield value; }\nfunction* items(count) { for (const value of middle(count)) yield value; }`],
]; // prettier-ignore
const firsts: [name: string, text: string][] = [
  ["numbers-alone", ""],
  ["an-object-first", "yield {};"],
];
const consumers: [name: string, around: (turn: string) => string][] = [
  ["for-of", turn => `for (const x of items(4)) { ${turn} }`],
  ["for-of-in-a-try", turn => `try { for (const x of items(4)) { ${turn} } } catch (error) { return "caught"; }`],
  ["for-of-left-early", turn => `for (const x of items(4)) { ${turn} if (i === 2) break; }`],
  ["by-next", turn => `const walk = items(4); for (let step = walk.next(); !step.done; step = walk.next()) { const x = step.value; ${turn} }`],
  ["over-a-spread", turn => `for (const x of [...items(4)]) { ${turn} }`],
  ["taken-apart", turn => `const [p, q, r] = items(4); for (const x of [p, q, r]) { ${turn} }`],
]; // prettier-ignore
const turns: [name: string, text: string][] = [
  ["counts", "i++; kinds += (typeof x)[0];"],
  ["calls-what-it-was-handed", "i++; kinds += (typeof x)[0]; hook(i);"],
  ["a-local-changes-its-kind", "i++; if (b !== mark) same = i; b = i < 2 ? i : mark;"],
  ["a-local-changes-its-kind-and-a-call", "i++; if (b !== mark) same = i; b = i < 2 ? i : mark; hook(i);"],
];
const callers: [name: string, around: (call: string) => string][] = [
  ["once", call => `console.log(${call});`],
  ["once-in-a-try", call => `let said; try { said = ${call}; } catch (error) { said = error.name; } console.log(said);`],
  ["in-a-loop", call => `for (let round = 0; round < 40; round++) { const said = ${call}; if (round < 1) console.log(said); }`],
  ["in-a-loop-with-one-made-beside", call => `for (let round = 0; round < 40; round++) { const made = items(4); const said = ${call}; if (round < 1) console.log(said, typeof made); }`],
]; // prettier-ignore
const marks: [name: string, text: string][] = [
  ["a-mark-nobody-knows", 'JSON.parse("null")'],
  ["a-written-mark", "null"],
];
const languages: [name: string, extension: string, head: string, tail: string][] = [
  ["a-module", "mjs", "", "export {};\n"],
  ["strict", "cjs", '"use strict";\n', ""],
  ["sloppy", "cjs", "", ""],
];

const all = producers.length * firsts.length * consumers.length * turns.length * callers.length * marks.length * languages.length; // prettier-ignore
function write(at: number): { name: string; text: string } {
  const take = <T>(from: readonly T[]) => {
    const one = from[at % from.length];
    at = Math.floor(at / from.length);
    return one;
  };
  const [language, extension, head, tail] = take(languages);
  const [mark, given] = take(marks);
  const [caller, called] = take(callers);
  const [turn, statements] = take(turns);
  const [consumer, around] = take(consumers);
  const [first, yielded] = take(firsts);
  const [producer, generators] = take(producers);
  return {
    name: `${producer}--${first}--${consumer}--${turn}--${caller}--${mark}--${language}.${extension}`,
    text: `${head}let closed = 0;
${generators.replace("FIRST", yielded)}
function run(mark, hook) { var b = 0; let same = -1, i = -1, kinds = ""; ${around(statements)} return [typeof b, String(b), same, i, kinds].join("|"); }
const hook = value => value;
${called(`run(${given}, hook)`)}
console.log(String(closed));
${tail}`,
  };
}

const pad = (at: number) => String(at).padStart(5, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, most] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let written = 0;
  for (let at = 0; at < all && written < most; at++) {
    const program = write(at);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
    written++;
  }
  console.log(written);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? all), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, all); step++) {
    const at = (from + step * stride) % all;
    const program = write(at);
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, all));
}
