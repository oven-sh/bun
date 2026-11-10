// Generates programs where a loop over an array of numbers updates a running aggregate and stores it into an output array.
// Each program combines one entry from each table: the loop, the aggregate, the store, the input array, the output array and the caller.
// The program number selects the entries, so a number always produces the same program. Each program is compiled on its own.
//
//   bun write-running-aggregate-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<loop>--<aggregate>--<store>--<input>--<output>--<caller>.js
//   bun write-running-aggregate-sweep.ts count
//   bun write-running-aggregate-sweep.ts named <pattern> <folder> [limit]
import { mkdirSync, writeFileSync } from "fs";

// ITERATION is replaced with the statements of one iteration. `array` is the input array and `index` is the current index.
const loops: [string, string][] = [
  ["descending", "for (let index = array.length - 1; index >= 0; index--) {\n  ITERATION\n}"],
  ["ascending", "for (let index = 0; index < array.length; index++) {\n  ITERATION\n}"],
  ["ascending-cached-length", "for (let index = 0, length = array.length; index < length; index++) {\n  ITERATION\n}"],
  ["descending-while", "let index = array.length;\nwhile (index-- > 0) {\n  ITERATION\n}"],
  [
    "ascending-do-while",
    "let index = 0;\nif (array.length > 0)\n  do {\n    ITERATION\n  } while (++index < array.length);",
  ],
  ["for-of-with-counter", "let index = -1;\nfor (const item of array) {\n  index++;\n  ITERATION\n}"],
  ["descending-by-two", "for (let index = array.length - 1; index >= 0; index -= 2) {\n  ITERATION\n}"],
  ["for-each", "array.forEach((item, index) => {\n  ITERATION\n});"],
];

// The declaration before the loop, and the update in each iteration.
const aggregates: [string, string, string][] = [
  ["max-with-if", "let aggregate = -1;", "if (array[index] > aggregate) aggregate = array[index];"],
  ["min-with-if", "let aggregate = 1e9;", "if (array[index] < aggregate) aggregate = array[index];"],
  ["max-with-ternary", "let aggregate = -1;", "aggregate = array[index] > aggregate ? array[index] : aggregate;"],
  ["max-with-math-max", "let aggregate = -1;", "aggregate = Math.max(aggregate, array[index]);"],
  ["sum", "let aggregate = 0;", "aggregate += array[index];"],
  ["count-above-threshold", "let aggregate = 0;", "if (array[index] > 2) aggregate++;"],
  ["last-visited", "let aggregate;", "aggregate = array[index];"],
  ["index-of-max", "let aggregate = -1;", "if (aggregate < 0 || array[index] > array[aggregate]) aggregate = index;"],
  [
    "max-with-single-read",
    "let aggregate = -1;",
    "const element = array[index];\nif (element > aggregate) aggregate = element;",
  ],
];

const stores: [string, string][] = [
  ["store-at-next-index", "output[index + 1] = aggregate;"],
  ["store-at-same-index", "output[index] = aggregate;"],
  ["push", "output.push(aggregate);"],
  ["store-at-length", "output[output.length] = aggregate;"],
  ["store-at-mirrored-index", "output[array.length - 1 - index] = aggregate;"],
  ["conditional-store", "if (aggregate > 1) output[index] = aggregate;"],
  ["read-modify-write", "output[index] = (output[index] ?? 0) + aggregate;"],
  ["store-into-input", "array[index] = aggregate;"],
];

const inputs: [string, string][] = [
  ["json-integers", 'JSON.parse("[1,5,2,4]")'],
  ["literal", "[1, 5, 2, 4]"],
  ["json-doubles", 'JSON.parse("[1.5,5,2.25,4]")'],
  ["array-from", "Array.from({ length: 4 }, (_, index) => (index * 7) % 5)"],
  ["float64array", "Float64Array.of(1, 5, 2, 4)"],
  ["holey-literal", "[1, , 2, 4]"],
  ["empty-literal", "[]"],
];

// The output array is either created by the caller and passed as a parameter, or created in the function before the loop.
const outputs: [string, string, boolean][] = [
  ["empty-parameter-output", "[]", true],
  ["empty-local-output", "[]", false],
  ["presized-local-output", "new Array(array.length)", false],
  ["zero-filled-local-output", "new Array(array.length + 1).fill(0)", false],
  ["float64array-parameter-output", "new Float64Array(6)", true],
];

const callers = ["function", "function-in-loop", "static-method"];

const total = loops.length * aggregates.length * stores.length * inputs.length * outputs.length * callers.length;

const indent = (source: string, prefix = "  ") => prefix + source.replaceAll("\n", "\n" + prefix);
const joinLines = (...parts: string[]) => parts.filter(Boolean).join("\n");

function write(index: number): { name: string; text: string } {
  const pick = <T>(table: readonly T[]): T => {
    const entry = table[index % table.length];
    index = Math.floor(index / table.length);
    return entry;
  };
  const [aggregateName, declaration, update] = pick(aggregates);
  const [loopName, loop] = pick(loops);
  const [storeName, store] = pick(stores);
  const [outputName, outputInitializer, isOutputParameter] = pick(outputs);
  const [inputName, input] = pick(inputs);
  const caller = pick(callers);
  const body = joinLines(
    isOutputParameter ? "" : `const output = ${outputInitializer};`,
    declaration,
    loop.replace(/^( *)ITERATION$/m, (_, prefix) => indent(joinLines(update, store), prefix)),
    'return String(aggregate) + " | " + Array.from(output).join();',
  );
  const parameters = isOutputParameter ? "(array, output)" : "(array)";
  const callArguments = isOutputParameter ? `(${input}, ${outputInitializer})` : `(${input})`;
  const emitCall = (call: string) => joinLines("try {", `  console.log(${call});`, "} catch (error) {", "  console.log(error.constructor.name);", "}"); // prettier-ignore
  const text =
    caller === "static-method"
      ? joinLines(
          "class Runner {",
          indent(joinLines(`static run${parameters} {`, indent(body), "}")),
          "}",
          emitCall(`Runner.run${callArguments}`),
        )
      : joinLines(
          `function run${parameters} {`,
          indent(body),
          "}",
          caller === "function"
            ? emitCall(`run${callArguments}`)
            : joinLines("for (let repeat = 0; repeat < 3; repeat++) {", indent(emitCall(`run${callArguments}`)), "}"),
        );
  return {
    name: `${loopName}--${aggregateName}--${storeName}--${inputName}--${outputName}--${caller}.js`,
    text: text + "\n",
  };
}

const padNumber = (index: number) => String(index).padStart(5, "0");
if (process.argv[2] === "count") console.log(total);
else if (process.argv[2] === "named") {
  const [pattern, folder, limit] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let written = 0;
  for (let index = 0; index < total && written < limit; index++) {
    const program = write(index);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${padNumber(index)}-${program.name}`, program.text);
    written++;
  }
  console.log(written);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? total), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, total); step++) {
    const index = (from + step * stride) % total;
    const program = write(index);
    writeFileSync(`${folder}/${padNumber(index)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, total));
}
