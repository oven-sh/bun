// Generates programs where an indexed loop contains, or is wrapped in, a try/catch/finally or an early exit.
// Each program combines one entry from each table: the kind of function, the loop, the operation in each iteration, the handler, the array-like value and the caller.
// The program number selects the entries, so a number always produces the same program. Each program is compiled on its own.
//
//   bun write-loop-exception-handler-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<function>--<loop>--<operation>--<handler>--<array-like>--<caller>.mjs
//   bun write-loop-exception-handler-sweep.ts count
//   bun write-loop-exception-handler-sweep.ts named <pattern> <folder> [limit]
import { mkdirSync, writeFileSync } from "fs";

// The declaration, an extra statement at the end of each iteration, and the expression that consumes the call.
// BODY is replaced with the function body and CALL with the call.
const functionKinds: [string, string, string, string][] = [
  ["function", "function run(arrayLike, end) {\nBODY\n}", "", "CALL"],
  ["arrow-function", "const run = (arrayLike, end) => {\nBODY\n};", "", "CALL"],
  [
    "static-method",
    "class Runner {\n  static run(arrayLike, end) {\nBODY\n  }\n}\nconst run = (arrayLike, end) => Runner.run(arrayLike, end);",
    "",
    "CALL",
  ],
  ["async-function", "async function run(arrayLike, end) {\nBODY\n}", "", "await CALL"],
  ["async-function-with-await", "async function run(arrayLike, end) {\nBODY\n}", "await null;", "await CALL"],
  ["generator", "function* run(arrayLike, end) {\nBODY\n}", "", "[...CALL].length"],
  ["generator-with-yield", "function* run(arrayLike, end) {\nBODY\n}", "yield index;", "[...CALL].join()"],
  ["async-generator-with-yield", "async function* run(arrayLike, end) {\nBODY\n}", "yield index;", "(await Array.fromAsync(CALL)).join()"], // prettier-ignore
];

// ITERATION is replaced with the statements of one iteration. `bound` is the `end` parameter converted to an int32.
const loops: [string, string][] = [
  ["ascending-for", "for (let index = 0; index < bound; index++) {\n  ITERATION\n}"],
  ["descending-for", "for (let index = bound - 1; index >= 0; index--) {\n  ITERATION\n}"],
  ["while", "let index = 0;\nwhile (index < bound) {\n  ITERATION\n  index = (index + 1) | 0;\n}"],
  ["do-while", "let index = 0;\ndo {\n  ITERATION\n  index = (index + 1) | 0;\n} while (index < bound);"],
  [
    "for-with-compound-condition",
    "let iterations = 0;\nfor (let index = 0; bound && iterations++ < 8 && index < bound; index++) {\n  ITERATION\n}",
  ],
  ["infinite-for-with-break", "for (let index = 0; ; index++) {\n  if (index >= bound) break;\n  ITERATION\n}"],
  ["descending-from-length", "for (let index = arrayLike.length - 1; index >= 0; index--) {\n  ITERATION\n}"],
  [
    "nested-for",
    "for (let repeat = 0; repeat < 2; repeat++) {\n  for (let index = 0; index < bound; index++) {\n    ITERATION\n  }\n}",
  ],
];

const operations: [string, string][] = [
  ["remainder-into-module-variable", "const element = arrayLike[index];\nsum %= element;"],
  ["sum-into-module-variable", "sum += arrayLike[index];"],
  [
    "typeof-guarded-property-store",
    'const element = arrayLike[index];\nif (typeof element === "string") box.value = element.length;',
  ],
  ["string-concatenation", 'log += arrayLike[index] + " ";'],
  ["adjacent-element-comparison", "if (index > 0 && arrayLike[index] === arrayLike[index - 1]) count++;"],
  ["push-to-module-array", "output.push(arrayLike[index]);"],
];

// The statements of one iteration, and the statements around the loop. OPERATION is replaced with the operation and LOOP with the whole loop.
const handlers: [string, string, string][] = [
  ["no-handler", "OPERATION", "LOOP"],
  [
    "try-catch-after-operation",
    'OPERATION\ntry {\n  if (index === 2) throw new Error("iteration");\n  count++;\n} catch (error) {\n  log += "caught" + index;\n}',
    "LOOP",
  ],
  [
    "try-catch-around-operation",
    'try {\n  OPERATION\n  if (index === 2) throw new Error("iteration");\n} catch (error) {\n  log += "caught" + index;\n}',
    "LOOP",
  ],
  ["try-finally-around-operation", "try {\n  OPERATION\n} finally {\n  count++;\n}", "LOOP"],
  [
    "try-catch-around-loop",
    'OPERATION\nif (index === 2) throw new Error("iteration");',
    'try {\n  LOOP\n} catch (error) {\n  log += "caught";\n}',
  ],
  ["conditional-break", "OPERATION\nif (index === 2) break;", "LOOP"],
  ["if-before-operation", "if (index === 1 && count < 9) {\n  count += 10;\n}\nOPERATION", "LOOP"],
];

const arrayLikes: [string, string][] = [
  ["json-string", "JSON.parse('\"abcd\"')"],
  ["string-literal", '"aabb"'],
  ["json-integers", 'JSON.parse("[1,5,2,4]")'],
  ["json-doubles", 'JSON.parse("[1.5,5,2.25,4]")'],
  ["uint8array", "Uint8Array.of(1, 5, 2, 4)"],
  ["arguments-object", "(function () {\n  return arguments;\n})(1, 5, 2, 4)"],
  ["object-with-length", "{ length: 4, 0: 1, 1: 5, 2: 2, 3: 4 }"],
  ["holey-array-literal", "[1, , 2, 4]"],
];

const callers = ["single-call", "one-iteration-loop", "three-calls-different-bounds"];

const total =
  functionKinds.length * loops.length * operations.length * handlers.length * arrayLikes.length * callers.length;

const indent = (source: string, prefix = "  ") => prefix + source.replaceAll("\n", "\n" + prefix);
const joinLines = (...parts: string[]) => parts.filter(Boolean).join("\n");
const substitute = (template: string, placeholder: string, source: string) =>
  template.replace(new RegExp(`^( *)${placeholder}$`, "m"), (_, prefix) => indent(source, prefix));

function write(index: number): { name: string; text: string } {
  const pick = <T>(table: readonly T[]): T => {
    const entry = table[index % table.length];
    index = Math.floor(index / table.length);
    return entry;
  };
  const [handlerName, iterationTemplate, loopTemplate] = pick(handlers);
  const [loopName, loop] = pick(loops);
  const [functionKind, declaration, extraStatement, callTemplate] = pick(functionKinds);
  const [operationName, operation] = pick(operations);
  const [arrayLikeName, arrayLike] = pick(arrayLikes);
  const caller = pick(callers);
  // A multi-line expression or an object literal is returned from a factory function instead of being written in the call.
  const needsFactory = arrayLike.includes("\n") || arrayLike.startsWith("{");
  const iteration = joinLines(substitute(iterationTemplate, "OPERATION", operation), extraStatement);
  const body = joinLines(
    "const bound = end | 0;",
    substitute(loopTemplate, "LOOP", substitute(loop, "ITERATION", iteration)),
    functionKind.includes("generator") ? "" : "return count;",
  );
  const functionSource = substitute(declaration, "BODY", indent(body, declaration.startsWith("class") ? "    " : "  "));
  const emitCall = (end: string) =>
    joinLines(
      "try {",
      `  result = String(${callTemplate.replace("CALL", () => `run(${needsFactory ? "createArrayLike()" : arrayLike}, ${end})`)});`,
      "} catch (error) {",
      "  result = error.constructor.name;",
      "}",
      'console.log([result, sum, box.value, log, count, output.join()].join(" | "));',
    );
  const calls =
    caller === "single-call"
      ? emitCall("4")
      : caller === "one-iteration-loop"
        ? joinLines("for (let repeat = 0; repeat < 1; repeat++) {", indent(emitCall("9")), "}")
        : joinLines(emitCall("3"), emitCall("0"), emitCall("4"));
  return {
    name: `${functionKind}--${loopName}--${operationName}--${handlerName}--${arrayLikeName}--${caller}.mjs`,
    text:
      joinLines(
        "let sum = 0.5;",
        'let log = "";',
        "let count = 0;",
        "const box = { value: 0 };",
        "const output = [];",
        needsFactory ? `const createArrayLike = () => (${arrayLike});` : "",
        functionSource,
        "let result;",
        calls,
      ) + "\n",
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
