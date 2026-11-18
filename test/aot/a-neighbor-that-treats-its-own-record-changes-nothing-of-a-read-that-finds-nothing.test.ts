// reader.js reads a name that none of its records has, off a parameter whose type a declaration file writes: the record itself is asked whether it has gained a property, and behind its answer the read is undefined.
// A neighbor, which reader.js never names, makes a record of the same names and links it anew, or lays another name, an accessor and a delete on it, in plain sight. A record of the same names is one layout for the whole
// program, and what code in sight does to such objects used to withhold the form: the reader was built one way alone and another way beside the neighbor.
// How a function is compiled may not hang on the rest of the program: the looks are tests, and the neighbor's own record fails them where it arrives.
// The reader is kept, and the neighbor's record is found, under names that only the run knows: the program does not see who calls the reader with what. What spelled names of the global object hold is followed.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run as runTestaot } from "./engine/testaot";
import { without } from "./harness/capabilities";
import { run } from "./harness/run";
import { test } from "./supported";

const reader = `export function make(i) { return { value: i, issues: [] }; }
export function read(o) { if (o.memo) return "found " + o.memo; return "nothing"; }
`;
const declarations = `export interface Payload { value: number; issues: unknown[]; }
export function make(i: number): Payload;
export function read(o: Payload): string;
`;
const asks = `import { make, read } from "./reader.js";
globalThis[process.argv[9] ?? "kept"] = [read, make(1)];
const neighbor = globalThis[process.argv[9] ?? "neighbor"];
console.log(read(make(JSON.parse("2"))), "|", neighbor ? read(neighbor) : "alone");
`;

async function buildAloneAndBeside(neighbor: string) {
  using dir = tempDir("aot-a-neighbor-that-treats-its-own-record", {
    "reader.js": reader,
    "reader.d.ts": declarations,
    "neighbor.js": neighbor,
    "main-alone.js": asks,
    "main-beside.js": `import "./neighbor.js";\n${asks}`,
  });
  const cwd = String(dir);
  const built: Record<string, { said: string; walk: string }> = {};
  for (const name of ["alone", "beside"]) {
    const [executable, wire] = [join(cwd, `program-${name}`), join(cwd, `${name}.wire`)];
    const build = [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      `--aot-out=${wire}`,
      `main-${name}.js`,
      "--outfile",
      executable,
    ];
    expect((await run(build, cwd, bunEnv)).exitCode).toBe(0);
    const said = (await run([executable], cwd, bunEnv)).stdout.trim();
    const printed = (await runTestaot("print", wire)).lines;
    const unit = printed.find(line => /^function f\d+ name="read" /.test(line))!.split(" ")[1];
    const walk = (await runTestaot("walk", wire, `${unit}:Body`)).lines
      .filter(line => !line.startsWith("code ") && !line.includes(" frame "))
      .join("\n")
      .replace(/\b[Lfmgd]\d+\b/g, "#")
      .replace(/subject=\d+/g, "subject=#");
    built[name] = { said, walk };
  }
  expect(built.alone.said).toBe("nothing | alone");
  expect(built.alone.walk).toContain("= HasNoExtraProperties");
  return built;
}

// An object below another prototype than its layout's bears the mark that the shape test refuses, unless code in sight gives objects of the layout another one: then the prototype is asked too.
test.skipIf(!!without("testaot"))(
  "a neighbor that links its own record anew has the prototype asked beside the shape",
  async () => {
    const built = await buildAloneAndBeside(`const made = { value: 1, issues: [] };
Object.setPrototypeOf(made, { memo: "above" });
globalThis.neighbor = made;
`);
    expect(built.beside.said).toBe("nothing | found above");
    expect(built.alone.walk).not.toContain("= HasLayoutPrototype");
    expect(built.beside.walk).toContain("= HasNoExtraProperties");
    expect(built.beside.walk).toContain("= HasLayoutPrototype");
  },
  240_000,
);

test.skipIf(!!without("testaot"))(
  "a neighbor that lays another name, a delete and an accessor on its own record changes nothing of a read that finds nothing",
  async () => {
    const built = await buildAloneAndBeside(`const made = { value: 1, issues: [] };
made.other = "stored";
delete made.value;
Object.defineProperty(made, "issues", { get() { return []; } });
globalThis.neighbor = made;
`);
    expect(built.beside.said).toBe("nothing | nothing");
    expect(built.beside.walk).toBe(built.alone.walk);
  },
  240_000,
);

// The store gives the one layout of those names a slot under `memo`, and whether there is such a slot is what makes either form of the read right.
(without("testaot") ? test.skip : test.failing)(
  "a neighbor that stores the very name on its own record changes the read: a record of the same names is one layout for the whole program",
  async () => {
    const built = await buildAloneAndBeside(`const made = { value: 1, issues: [] };
made.memo = "stored";
globalThis.neighbor = made;
`);
    expect(built.beside.said).toBe("nothing | found stored");
    expect(built.beside.walk).toBe(built.alone.walk);
  },
  240_000,
);
