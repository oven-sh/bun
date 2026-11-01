// An error for lack of memory can be caught, and whoever catches it looks at the program: at its variables, and at which `catch` got the error.
// The compiler lets a loop's stores wait, makes a look-up once in front of a loop, and cuts a piece out of a text only where the piece is needed. None of it may show where memory runs out. How the error is made: ./oom-injection.test.ts.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, spawned } from "./harness/commands";
import { compileCommand } from "./harness/flags";
import { test } from "./supported";

const env = { ...bunEnv, NO_COLOR: "1" };

// The build must not know how long the text is: operations on a text that it can see whole cannot throw.
const texts = `const half = "\\u0100".repeat(Number(process.argv[9] ?? 16));
const joined = half + half;
const texts = ["a", "b", joined, "c"];
`;

type Program = { source: string; undisturbed: string; whereMemoryRunsOut: string };

const storesThatWait: Record<string, Program> = {
  "a variable of the module": {
    source: `let count = 0;
function sum(texts) { let total = 0; for (let i = 0; i < texts.length; i++) { count = count + 1; total += texts[i].charCodeAt(0); } return total; }
let said; try { said = sum(texts); } catch (error) { said = error.name; }
console.log(said, count);`,
    undisturbed: "550 4\n",
    whereMemoryRunsOut: "RangeError 3\n",
  },
  "a variable that a closure shares": {
    source: `function make() { let count = 0; return { sum(texts) { let total = 0; for (let i = 0; i < texts.length; i++) { count = count + 1; total += texts[i].charCodeAt(0); } return total; }, count: () => count }; }
const made = make();
let said; try { said = made.sum(texts); } catch (error) { said = error.name; }
console.log(said, made.count());`,
    undisturbed: "550 4\n",
    whereMemoryRunsOut: "RangeError 3\n",
  },
  "a static field": {
    source: `class Counter { static count = 0; static sum(texts) { let total = 0; for (let i = 0; i < texts.length; i++) { Counter.count = Counter.count + 1; total += texts[i].charCodeAt(0); } return total; } }
let said; try { said = Counter.sum(texts); } catch (error) { said = error.name; }
console.log(said, Counter.count);`,
    undisturbed: "550 4\n",
    whereMemoryRunsOut: "RangeError 3\n",
  },
  "a counter beside the cells of a view that it counts": {
    source: `const cells = new Int32Array(8); let at = 0;
function fill(cells, texts) { for (let i = 0; i < texts.length; i++) { cells[at] = i + 1; at = at + 1; cells[at] = texts[i].charCodeAt(0); at = at + 1; } }
let said = "none"; try { fill(cells, texts); } catch (error) { said = error.name; }
console.log(said, at, cells.join());`,
    undisturbed: "none 8 1,97,2,98,3,256,4,99\n",
    whereMemoryRunsOut: "RangeError 5 1,97,2,98,3,0,0,0\n",
  },
  "a variable stored behind a loop inside the loop": {
    source: `let count = 0;
function scan(texts, length) { for (let row = 0; row < texts.length; row++) { const text = texts[row]; for (let i = 0; i < length; i++) { if (text.charCodeAt(i) === 33) return i; } count = count + 1; } return -1; }
let said; try { said = scan(texts, 1); } catch (error) { said = error.name; }
console.log(said, count);`,
    undisturbed: "-1 4\n",
    whereMemoryRunsOut: "RangeError 2\n",
  },
};

// To hash a text that was put together it is flattened.
const lookUpsWithTheSameKeyInEveryTurn: Record<string, Program> = {
  "Map.has, the try around the loop": {
    source: `function look(map, key, turns) { let found = 0; try { for (let i = 0; i < turns; i++) { if (map.has(key)) found++; } } catch (error) { return "caught " + error.name; } return "found " + found; }
let said; try { said = look(new Map([["a", 1]]), joined, 3); } catch (error) { said = "escaped " + error.name; }
console.log(said);`,
    undisturbed: "found 0\n",
    whereMemoryRunsOut: "caught RangeError\n",
  },
  "Map.get, the try around the loop": {
    source: `function look(map, key, turns) { let sum = 0; try { for (let i = 0; i < turns; i++) { sum += map.get(key) ?? 1; } } catch (error) { return "caught " + error.name; } return "sum " + sum; }
let said; try { said = look(new Map([["a", 1]]), joined, 3); } catch (error) { said = "escaped " + error.name; }
console.log(said);`,
    undisturbed: "sum 3\n",
    whereMemoryRunsOut: "caught RangeError\n",
  },
  "Set.has, the try around the loop": {
    source: `function look(set, key, turns) { let found = 0; try { for (let i = 0; i < turns; i++) { if (set.has(key)) found++; } } catch (error) { return "caught " + error.name; } return "found " + found; }
let said; try { said = look(new Set(["a"]), joined, 3); } catch (error) { said = "escaped " + error.name; }
console.log(said);`,
    undisturbed: "found 0\n",
    whereMemoryRunsOut: "caught RangeError\n",
  },
};

// The piece lies across the place where the two halves were put together, so cutting it flattens the text.
const ends = `const from = half.length - 1, to = half.length + 1;
`;
const piecesThatAreCutWhereTheyAreNeeded: Record<string, Program> = {
  "cut in a try, read behind it": {
    source: `${ends}function cut(text) { let part = "none"; try { part = text.substring(from, to); } catch (error) { return "caught " + error.name; } return "cut " + part.length + " " + part.charCodeAt(0); }
let said; try { said = cut(joined); } catch (error) { said = "escaped " + error.name; }
console.log(said);`,
    undisturbed: "cut 2 256\n",
    whereMemoryRunsOut: "caught RangeError\n",
  },
  "cut in a try, read in another": {
    source: `${ends}function cut(text) { let part = "none"; try { part = text.substring(from, to); } catch (error) { return "the first caught " + error.name; } try { return "cut " + part.charCodeAt(0); } catch (error) { return "the second caught " + error.name; } }
let said; try { said = cut(joined); } catch (error) { said = "escaped " + error.name; }
console.log(said);`,
    undisturbed: "cut 256\n",
    whereMemoryRunsOut: "the first caught RangeError\n",
  },
  "a piece of a piece": {
    source: `${ends}function cut(text) { let part = "none"; try { part = text.substring(from - 4, to + 4).substring(4, 6); } catch (error) { return "caught " + error.name; } return "cut " + part.charCodeAt(0); }
let said; try { said = cut(joined); } catch (error) { said = "escaped " + error.name; }
console.log(said);`,
    undisturbed: "cut 256\n",
    whereMemoryRunsOut: "caught RangeError\n",
  },
  "cut in front of a try, read inside it": {
    source: `${ends}function cut(text) { const part = text.substring(from, to); try { return "cut " + part.charCodeAt(0); } catch (error) { return "caught inside " + error.name; } }
let said; try { said = cut(joined); } catch (error) { said = "left the function: " + error.name; }
console.log(said);`,
    undisturbed: "cut 256\n",
    whereMemoryRunsOut: "left the function: RangeError\n",
  },
  "slice": {
    source: `${ends}function cut(text) { let part = "none"; try { part = text.slice(from, to); } catch (error) { return "caught " + error.name; } return "cut " + part.charCodeAt(1); }
let said; try { said = cut(joined); } catch (error) { said = "escaped " + error.name; }
console.log(said);`,
    undisturbed: "cut 256\n",
    whereMemoryRunsOut: "caught RangeError\n",
  },
};

async function build(source: string, flag: string) {
  const dir = tempDir("aot-memory-runs-out", { "program.js": texts + source + "\n" });
  const executable = join(String(dir), isWindows ? "app.exe" : "app");
  built(
    await spawned(
      [bunExe(), ...compileCommand, flag, join(String(dir), "program.js"), "--outfile", executable],
      String(dir),
      env,
    ),
  );
  const run = async (at?: string) => {
    const ran = await spawned(
      [executable],
      String(dir),
      at === undefined ? env : { ...env, BUN_AOT_OUT_OF_MEMORY_AT: at },
    );
    return { stdout: ran.stdout, exitCode: ran.exitCode };
  };
  return { dir, run };
}

function answersAsWritten(programs: Record<string, Program>) {
  return async (name: string) => {
    const { source, undisturbed, whereMemoryRunsOut } = programs[name];
    // The second build was told that these operations throw by rule, so it moves nothing across them.
    for (const flag of ["--aot-sabotage=MemoryRunsOutWhenCounted", "--aot-sabotage=MemoryRunsOutWhenCountedByRule"]) {
      const { dir, run } = await build(source, flag);
      using _ = dir;
      expect({ flag, ...(await run()) }).toEqual({ flag, stdout: undisturbed, exitCode: 0 });
      expect({ flag, ...(await run("flattening:1")) }).toEqual({ flag, stdout: whereMemoryRunsOut, exitCode: 0 });
    }
  };
}

test.each(Object.keys(storesThatWait))(
  "the stores of a loop that wait are made where memory runs out: %s",
  answersAsWritten(storesThatWait),
  300_000,
);
test.each(Object.keys(lookUpsWithTheSameKeyInEveryTurn))(
  "a look-up that is made once for a loop stays inside its try: %s",
  answersAsWritten(lookUpsWithTheSameKeyInEveryTurn),
  300_000,
);
test.each(Object.keys(piecesThatAreCutWhereTheyAreNeeded))(
  "a piece of a text is cut under the handler that covers the cutting: %s",
  answersAsWritten(piecesThatAreCutWhereTheyAreNeeded),
  300_000,
);
