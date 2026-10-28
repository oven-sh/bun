// Untyped code reads, stores and calls by name. The functions that come first in the order of the static call graph, until they hold 32,768 such accesses, remember at each place
// where the property was found last time, and are compiled in the forms for hot code. The rest of a larger program is compiled as compactly as before. A name that is an accessor
// of a host class's locked prototype (`request.url`, `url.pathname`) is not remembered where the receiver may be such an object: no place could ever serve it.
import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { run } from "./harness/run";
import { test } from "./supported";

async function bytesOfFunctions(program: string) {
  using dir = tempDir("aot-hottest-functions", { "main.js": program });
  const cwd = String(dir);
  const executable = join(cwd, isWindows ? "main.exe" : "main");
  const map = join(cwd, "main.map");
  const built = await run([bunExe(), "build", "--compile", "--aot", "./main.js", "--outfile", executable], cwd, {
    ...bunEnv,
    BUN_JSC_aotMapFilePath: map,
  });
  expect({ output: built.exitCode ? built.stdout + built.stderr : "", exitCode: built.exitCode }).toEqual({
    output: "",
    exitCode: 0,
  });
  const plain = await run([bunExe(), "run", "./main.js"], cwd);
  expect(plain.exitCode).toBe(0);
  expect(await run([executable], cwd)).toEqual(plain);
  const bytes = new Map<string, number>();
  for (const line of readFileSync(map, "utf8").split("\n")) {
    const fields = line.split("\t");
    if (fields[0] === "F") bytes.set(fields[7], (bytes.get(fields[7]) ?? 0) + Number(fields[3]));
  }
  return bytes;
}

const callsEach = (names: string[], argument: string) =>
  `const all = [${names.join(", ")}];\nlet text = "";\nfor (let turn = 0; turn < 3; turn++) for (const each of all) text = String(String(each(${argument})).length + text.length);\nconsole.log(text);\n`;

// No number of accesses decides: an access by name has one form wherever it stands, and all these functions have one size.
test.todo(
  "a program with more accesses by name than the number: the first in the order have caches, the last are compact",
  async () => {
    const count = 3_000;
    const reads = 12;
    const names = Array.from({ length: count }, (_, i) => `reads${i}`);
    const functions = names.map(
      name => `function ${name}(o) { return [${Array.from({ length: reads }, (_, r) => `o.p${r}`).join(", ")}]; }\n`,
    );
    const thing = `{ ${Array.from({ length: reads }, (_, r) => `p${r}: ${r}`).join(", ")} }`;
    const bytes = await bytesOfFunctions(functions.join("") + callsEach(names, thing));
    const sizes = new Map<number, number>();
    for (const name of names) sizes.set(bytes.get(name)!, (sizes.get(bytes.get(name)!) ?? 0) + 1);
    const [[compact, withoutCaches], [large, withCaches]] = [...sizes].sort((a, b) => a[0] - b[0]);
    expect(sizes.size).toBe(2);
    expect(large).toBeGreaterThan(compact + reads * 20);
    expect(withCaches * reads).toBeLessThanOrEqual(32_768);
    expect(withCaches * reads).toBeGreaterThan(30_000);
    expect(withoutCaches).toBe(count - withCaches);
  },
  240_000,
);

// These names are read and stored as every other name.
test.todo(
  "a name that is an accessor of a host prototype has no cache; a name of the same length that is not has one",
  async () => {
    const pairs = [
      ["url", "urk"],
      ["method", "methoe"],
      ["headers", "headerz"],
      ["pathname", "pathnamf"],
      ["searchParams", "searchParamz"],
      ["status", "statut"],
    ];
    const functions = pairs
      .flat()
      .map(
        name =>
          `function reads_${name}(o) { return o.${name}; }\nfunction stores_${name}(o) { o.${name} = 1; return o; }\n`,
      );
    const names = pairs.flat().flatMap(name => [`reads_${name}`, `stores_${name}`]);
    const thing = `{ ${pairs
      .flat()
      .map(name => `${name}: "${name}"`)
      .join(", ")} }`;
    const bytes = await bytesOfFunctions(functions.join("") + callsEach(names, thing));
    for (const [ofHost, other] of pairs) {
      for (const what of ["reads_", "stores_"]) {
        expect({ name: what + ofHost, isSmaller: bytes.get(what + ofHost)! + 20 < bytes.get(what + other)! }).toEqual({
          name: what + ofHost,
          isSmaller: true,
        });
      }
    }
  },
  240_000,
);
