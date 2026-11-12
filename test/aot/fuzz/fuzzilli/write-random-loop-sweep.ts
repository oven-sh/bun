// Generates small random programs that loop over arrays of numbers: 1 to 3 loops, nested up to 3 deep.
// Each loop gets a random header (ascending, descending, while, do-while, for-of, bounds passed as parameters, or bounds that depend on the enclosing loop's index)
// and 1 to 3 random statements per iteration (a sum, a running maximum, a count, a string, a store into an output array, a switch, a break or continue, a nested loop).
// The array source, the output array, the caller and the file type (JavaScript or TypeScript) are random too.
// No loop changes the length of the array it iterates, so every program terminates. Each program prints all of its results on one line.
// The program number is the random seed, so a number always produces the same program. From 4,000,000 up, each store picks its index and its value independently,
// and the running maximum starts at a random value. From 8,000,000 up, a third of the loops also step the index inside the loop condition, and half of the functions return
// a loop index instead of the result string, with nothing between the last loop and the return.
//
//   bun write-random-loop-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<loops>-loops--depth-<depth>--<source>--<output>--<caller>.mjs or .ts
//   bun write-random-loop-sweep.ts count
//   bun write-random-loop-sweep.ts named <pattern> <folder> [limit]
import { mkdirSync, writeFileSync } from "fs";

const programsPerEdition = 4_000_000;
const total = 3 * programsPerEdition;

function createRandom(seed: number) {
  let state = (seed * 2654435761 + 977) >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let hash = Math.imul(state ^ (state >>> 15), state | 1);
    hash ^= hash + Math.imul(hash ^ (hash >>> 7), hash | 61);
    return ((hash ^ (hash >>> 14)) >>> 0) / 4294967296;
  };
  const below = (end: number) => Math.floor(next() * end);
  return { below, chance: (of: number) => next() < of, pick: <T>(list: readonly T[]): T => list[below(list.length)] };
}

const arrayLiterals = ["[1,2,3]", "[4,1,3,2]", "[1.5,2,0.25,8]", "[3,-1,2,-5,4]", "[7]", "[]", "[2,2,2,2,2,2]"];

const arraySources: [string, (json: string) => string][] = [
  ["literal", json => json.replaceAll(",", ", ")],
  ["json", json => `JSON.parse("${json}")`],
  ["array-from-json", json => `Array.from(JSON.parse("${json}"))`],
  ["sliced-json", json => `JSON.parse("${json}").slice()`],
  ["spread-json", json => `[...JSON.parse("${json}")]`],
  ["mapped-json", json => `JSON.parse("${json}").map(value => value * 1)`],
  ["float64array", json => `Float64Array.from(JSON.parse("${json}"))`],
];

const outputArrays: [string, string][] = [
  ["empty-output", "[]"],
  ["presized-output", "new Array(array.length)"],
  ["zero-filled-output", "new Array(array.length + 1).fill(0)"],
  ["float64array-output", "new Float64Array(array.length + 2)"],
];

const callers = ["top-level", "function", "function-in-loop", "async-function", "static-method", "generator"];

const indent = (source: string) => "  " + source.replaceAll("\n", "\n  ");

function write(seed: number): { name: string; text: string } {
  const random = createRandom(seed);
  const hasIndependentStores = seed >= programsPerEdition;
  const hasConditionSteps = seed >= 2 * programsPerEdition;
  const [sourceName, createArray] = random.pick(arraySources);
  const [outputName, outputInitializer] = random.pick(outputArrays);
  const caller = random.pick(callers);
  const hasSecondInput = random.chance(0.3);
  const isTypeScript = random.chance(0.4);
  const inputs = hasSecondInput ? ["array", "array", "otherArray"] : ["array"];
  let loopCount = 0;
  let maxDepth = 0;
  let functionScopedIndex: string | undefined;

  function emitLoop(depth: number, outerIndex: string | undefined): string {
    loopCount++;
    maxDepth = Math.max(maxDepth, depth + 1);
    const id = loopCount;
    const index = "i" + id;
    const input = random.pick(inputs);
    const header =
      hasConditionSteps && random.below(3) === 0 ? 13 + random.below(3) : random.below(outerIndex ? 13 : 11);
    if (depth === 0 && ((header >= 3 && header <= 7) || header === 9 || header >= 13)) functionScopedIndex = index;
    const hasIndex = header !== 8;
    const element = hasIndex ? `${input}[${index}]` : "item" + id;
    // A continue would skip the increment at the end of a while or do-while body.
    const allowsContinue = header <= 2 || header === 8 || header >= 10;
    const statements: string[] = [];
    for (let remaining = 1 + random.below(3); remaining > 0; remaining--) {
      const choice = random.below(depth < 2 && loopCount < 3 ? 21 : 19);
      if (choice === 0) statements.push(`sum += ${element};`);
      else if (choice === 1) statements.push(`sum += ${element} * 2;`);
      else if (choice === 2) statements.push(`if (${element} > best) best = ${element};`);
      else if (choice === 3) statements.push(`best = Math.max(best, ${element});`);
      else if (choice === 4) statements.push(`best = ${element} > best ? ${element} : best;`);
      else if (choice === 5) statements.push(`if (${element} > 2) count++;`);
      else if (choice === 6) statements.push(`joined += ${element} + ",";`);
      else if (choice === 7) statements.push(`output.push?.(${element});`);
      else if (choice === 8)
        statements.push(`const current${id}_${remaining} = ${element};\nsum += current${id}_${remaining};`);
      else if (choice === 9) statements.push(`if (${element} === 2) break;`);
      else if (choice === 10)
        statements.push(allowsContinue ? `if (${element} < 0) continue;` : `if (${element} < 0) count--;`);
      else if (hasIndependentStores && (choice === 11 || choice === 12)) {
        const indexChoices = hasIndex ? [index, `${index} + 1`, `${input}.length - 1 - ${index}`, "output.length"] : ["count", "count + 1", "output.length"]; // prettier-ignore
        statements.push(`output[${random.pick(indexChoices)}] = ${random.pick(["best", "sum", "count", element])};`);
      } else if (choice === 11) statements.push(hasIndex ? `output[${index}] = best;` : "output[count] = best;");
      else if (choice === 12) statements.push(hasIndex ? `output[${index} + 1] = sum;` : "output[count + 1] = sum;");
      else if (choice === 13) statements.push(hasIndex ? `lastIndex = ${index};` : "lastIndex++;");
      else if (choice === 14)
        statements.push(hasIndex ? `if (${index} > 0 && ${input}[${index}] === ${input}[${index} - 1]) count++;` : "count++;"); // prettier-ignore
      else if (choice === 15) statements.push(hasIndex ? `sum += ${index};` : "sum++;");
      else if (choice === 16) statements.push(outerIndex ? `sum += ${outerIndex};` : "count += 2;");
      else if (choice === 17) statements.push(`switch (${element}) {\n  case 2:\n    count++;\n}`);
      else if (choice === 18)
        statements.push(`switch (${element}) {\n  case 2:\n    count++;\n    break;\n  case 4:\n    count += 10;\n    break;\n  default:\n    sum += 100;\n}`); // prettier-ignore
      else statements.push(emitLoop(depth + 1, hasIndex ? index : outerIndex));
    }
    const body = indent(statements.join("\n"));
    // Reads the index after the loop. Only the headers that declare it outside the loop use this.
    const readIndexAfterLoop = random.chance(0.5) ? `\nlastIndex = ${index};` : "";
    if (header === 0) return `for (let ${index} = 0; ${index} < ${input}.length; ${index}++) {\n${body}\n}`;
    if (header === 1) return `for (let ${index} = ${input}.length - 1; ${index} >= 0; ${index}--) {\n${body}\n}`;
    if (header === 2) return `for (let ${index} = 0, length${id} = ${input}.length; ${index} < length${id}; ${index}++) {\n${body}\n}`; // prettier-ignore
    if (header === 3)
      return `let ${index} = ${input}.length;\nwhile (${index}-- > 0) {\n${body}\n}${readIndexAfterLoop}`;
    if (header === 4) return `let ${index} = 0;\nwhile (${index} < ${input}.length) {\n${body}\n  ${index}++;\n}${readIndexAfterLoop}`; // prettier-ignore
    if (header === 5) return `let ${index} = 0;\ndo {\n${body}\n  ${index}++;\n} while (${index} < ${input}.length);${readIndexAfterLoop}`; // prettier-ignore
    if (header === 6) return `let ${index} = ${input}.length - 1;\ndo {\n${body}\n  ${index}--;\n} while (${index} >= 0);${readIndexAfterLoop}`; // prettier-ignore
    if (header === 7) return `let ${index} = ${input}.length - 1;\nwhile (${index} >= 0) {\n${body}\n  ${index}--;\n}${readIndexAfterLoop}`; // prettier-ignore
    if (header === 8) return `for (const item${id} of ${input}) {\n${body}\n}`;
    if (header === 9)
      return `let ${index} = start;\nwhile (${index} < end) {\n${body}\n  ${index} += 1;\n}${readIndexAfterLoop}`;
    if (header === 10) return `for (let ${index} = start; ${index} < end; ${index}++) {\n${body}\n}`;
    if (header === 13)
      return `let ${index} = ${input}.length - 1;\ndo {\n${body}\n} while (--${index} >= 0);${readIndexAfterLoop}`;
    if (header === 14)
      return `let ${index} = 0;\ndo {\n${body}\n} while (++${index} < ${input}.length);${readIndexAfterLoop}`;
    if (header === 15)
      return `let ${index} = ${input}.length;\nwhile (--${index} >= 0) {\n${body}\n}${readIndexAfterLoop}`;
    if (header === 11)
      return `for (let ${index} = ${outerIndex} + 1; ${index} < ${input}.length; ${index}++) {\n${body}\n}`;
    return `for (let ${index} = 0; ${index} < ${outerIndex}; ${index}++) {\n${body}\n}`;
  }

  const topLevelLoops: string[] = [];
  for (let remaining = 1 + random.below(2); remaining > 0 && loopCount < 3; remaining--)
    topLevelLoops.push(emitLoop(0, undefined));
  const inputJson = random.pick(arrayLiterals);
  const secondInputJson = random.pick(arrayLiterals);
  const anyType = isTypeScript ? ": any" : "";
  const declarations = [
    `const output${anyType} = ${outputInitializer};`,
    "let sum = 0;",
    `let best${hasIndependentStores ? anyType : ""} = ${hasIndependentStores ? random.pick(["-1", "0", "undefined", "array[0]", "-Infinity"]) : "-1"};`,
    "let count = 0;",
    'let joined = "";',
    "let lastIndex = -2;",
  ].join("\n");
  const summary = '[sum, best, count, lastIndex].join() + " | " + joined + " | " + Array.from(output).join()';
  const returnsIndex = hasConditionSteps && functionScopedIndex !== undefined && random.chance(0.5);
  const result = returnsIndex ? functionScopedIndex : summary;
  const body = [declarations, ...topLevelLoops].join("\n");
  const [start, end] = [
    random.pick(["process.argv.length - 2", "process.argv.length - 1", "0"]),
    random.pick(["3", "5"]),
  ];
  const parameters = (hasSecondInput ? "array, otherArray" : "array") + ", start, end";
  const callArguments =
    (hasSecondInput ? `${createArray(inputJson)}, ${createArray(secondInputJson)}` : createArray(inputJson)) +
    `, ${start}, ${end}`;
  let program: string;
  if (caller === "top-level")
    program = [
      `const array${anyType} = ${createArray(inputJson)};`,
      `const start = ${start};`,
      `const end = ${end};`,
      // Array.from(JSON.parse(...)) has the type unknown[], which the type checker rejects in arithmetic.
      hasSecondInput
        ? `const otherArray${sourceName === "array-from-json" ? anyType : ""} = ${createArray(secondInputJson)};`
        : "",
      body,
      `console.log(${summary});`,
    ]
      .filter(Boolean)
      .join("\n");
  else if (caller === "function")
    program = `function run(${parameters}) {\n${indent(body)}\n  return ${result};\n}\nconsole.log(run(${callArguments}));`;
  else if (caller === "function-in-loop")
    program = `function run(${parameters}) {\n${indent(body)}\n  return ${result};\n}\nfor (let repeat = 0; repeat < 3; repeat++) console.log(run(${callArguments}));`;
  else if (caller === "async-function")
    program = `async function run(${parameters}) {\n${indent(body)}\n  return ${result};\n}\nconsole.log(await run(${callArguments}));`;
  else if (caller === "static-method")
    program = `class Runner {\n  static run(${parameters}) {\n${indent(indent(body))}\n    return ${result};\n  }\n}\nconsole.log(Runner.run(${callArguments}));`;
  else
    program = `function* run(${parameters}) {\n${indent(body)}\n  yield ${result};\n}\nconsole.log([...run(${callArguments})].join());`;
  return {
    name: `${loopCount}-loops--depth-${maxDepth}--${sourceName}--${outputName}--${caller}.${isTypeScript ? "ts" : "mjs"}`,
    text: program + "\n",
  };
}

const padNumber = (index: number) => String(index).padStart(7, "0");
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
