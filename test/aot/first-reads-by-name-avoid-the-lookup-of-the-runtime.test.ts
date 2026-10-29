import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { types } from "node:util";
import { separatePrograms, startsAtAnyEntryPoint } from "./harness/separate-programs";
import { test } from "./supported";

// Every read below runs once, on a receiver that comes back out of an array, so the compiler does not know what arrives: what a program does while it starts.
const copies = 40;
const each = (line: (index: number) => string) => Array.from({ length: copies }, (_, index) => line(index)).join("\n");
const head = `
  const shelf = [];
  function hide(value) { shelf.push(value); return shelf.pop(); }
  let sum = 0;
`;
const programs: Record<string, { text: string; sum: number }> = {
  // module.exports = { a, b }: the function objects are made when they are first read.
  "functions-in-a-literal": {
    text: `${each(i => `function a${i}() { return 1; } function b${i}() { return 2; } const exported${i} = { a${i}, b${i}, c${i}() { return 3; } };`)}
      ${each(i => `{ const { a${i}: a, b${i}: b, c${i}: c } = hide(exported${i}); sum += a() + b() + c(); }`)}`,
    sum: 6 * copies,
  },
  // A function that has members: module.exports = f; f.member = ..
  "members-of-a-function": {
    text: `${each(i => `function f${i}() { return 1; } f${i}.member${i} = ${i}; f${i}.other${i} = 1;`)}
      ${each(i => `{ const f = hide(f${i}); sum += f.member${i} + f.other${i} + (f.absent${i} === undefined ? 1 : 0) + (typeof f.call === "function" ? 1 : 0); }`)}`,
    sum: (copies * (copies - 1)) / 2 + 3 * copies,
  },
  // A function without members, an arrow too.
  "names-that-a-function-inherits": {
    text: `${each(i => `const g${i} = () => ${i}; function h${i}() { return ${i}; }`)}
      ${each(i => `{ const g = hide(g${i}), h = hide(h${i}); sum += (g.absent${i} === undefined ? 1 : 0) + (typeof g.bind === "function" ? 1 : 0) + (typeof h.apply === "function" ? 1 : 0); }`)}`,
    sum: 3 * copies,
  },
  // Most variables that a program asks for are not set.
  "variables-of-the-environment": {
    text: `const env = hide(process.env);
      ${each(i => `sum += env.A_VARIABLE_NOBODY_SETS_${i} === undefined ? 1 : 0;`)}
      sum += env.A_VARIABLE_THAT_IS_SET === "yes" ? 1 : 0;`,
    sum: copies + 1,
  },
  // Each method of an array is asked for once.
  "methods-of-an-array": {
    text: `const list = hide([1, 2, 3]), texts = hide(["a"]);
      for (const method of [list.at, list.concat, list.entries, list.every, list.fill, list.filter, list.find, list.findIndex, list.flat, list.flatMap, list.forEach, list.includes,
        list.indexOf, list.join, list.keys, list.lastIndexOf, list.map, list.pop, list.push, list.reduce, list.reverse, list.shift, list.slice, list.some, list.sort, list.splice,
        list.unshift, list.values, texts.map, texts.join, texts.slice, texts.indexOf]) sum += typeof method === "function" ? 1 : 0;
      ${each(i => `sum += list.absent${i} === undefined ? 1 : 0;`)}`,
    sum: 32 + copies,
  },
  // A function of the engine.
  "names-that-a-function-of-the-engine-lacks-or-inherits": {
    text: `const parse = hide(JSON.parse);
      ${each(i => `sum += parse.absent${i} === undefined ? 1 : 0;`)}
      sum += typeof parse.call === "function" ? 1 : 0;`,
    sum: copies + 1,
  },
  // F.prototype.method = ..: the object is made at the first read, and what the read finds behind that is the same for every function.
  "prototype-of-a-function": {
    text: `${each(i => `function F${i}() {}`)}
      ${each(i => `{ const F = hide(F${i}); F.prototype.method${i} = 1; sum += F.prototype.method${i}; }`)}`,
    sum: copies,
  },
};

const lookups = ["operationAOTGetById", "operationAOTGetByIdAndCache", "operationAOTGetGeneric"];
// At most so many lookups of the run time for `copies` copies.
const allowed: Record<string, number> = {
  "functions-in-a-literal": 8,
  "members-of-a-function": 8,
  "names-that-a-function-inherits": 8,
  // Where the object is a proxy, each read goes through the run time, which calls the trap: once a read and no more.
  "variables-of-the-environment": (types.isProxy(process.env) ? copies + 1 : 0) + 8,
  "methods-of-an-array": 8,
  "names-that-a-function-of-the-engine-lacks-or-inherits": 8,
  // One a function, which makes the object.
  "prototype-of-a-function": copies + 8,
};

const { folder, start } = separatePrograms(
  "aot-first-reads-by-name",
  Object.fromEntries(
    Object.entries(programs).map(([name, { text }]) => [`${name}.mjs`, `${head}${text}\nconsole.log(sum);`]),
  ),
  Object.keys(programs).map(name => `${name}.mjs`),
);

for (const [name, { sum }] of Object.entries(programs)) {
  test.skipIf(!startsAtAnyEntryPoint)(
    `${name}: what is read once is not looked up by the run time`,
    async () => {
      const path = join(folder, `counts-${name}`);
      const env = { A_VARIABLE_THAT_IS_SET: "yes", BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
      expect(await start(`${name}.mjs`, env)).toEqual({
        stdout: sum + "\n",
        stderr: "",
        exitCode: 0,
      });
      let calls = 0,
        filedAgain = 0;
      for (const line of readFileSync(path, "utf8").split("\n")) {
        const [count, operation] = line.split("\toperation:");
        if (operation !== undefined && lookups.includes(operation)) calls += Number(count);
        if (line.endsWith("\tcounter:PairsFiledAgainWhilePresent")) filedAgain = Number(line.split("\t")[0]);
      }
      expect({
        name,
        isSeldom: calls <= allowed[name],
        calls: calls <= allowed[name] ? 0 : calls,
        filedAgain: filedAgain <= 2 ? 0 : filedAgain,
      }).toEqual({
        name,
        isSeldom: true,
        calls: 0,
        filedAgain: 0,
      });
    },
    240_000,
  );
}
