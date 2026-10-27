import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runtimeEnvironment } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

const numberOfNames = 180;
const numbers = Array.from({ length: numberOfNames }, (_, index) => index);

// Six objects, each the prototype of the next, and four receivers of four shapes below them. Between any two rounds of reads, calls and stores one of the six is given a name that nobody reads.
const program = (give: (number: number) => string) => `
const chain = [Object.create(null)];
for (let k = 1; k < 6; k++) chain[k] = Object.create(chain[k - 1]);
chain[0].value = 10;
chain[0].method = function () { return 1; };
Object.defineProperty(chain[0], "computed", { get() { return 100; }, configurable: true });
function make() {
  const objects = [];
  for (let i = 0; i < 4; i++) {
    const object = Object.create(chain[5]);
    for (let k = 0; k < i; k++) object["own" + k] = k;
    object.shared = i;
    objects.push(object);
  }
  return objects;
}
const receivers = make();
function round() {
  let sum = 0;
  for (let i = 0; i < 16; i++) {
    const object = receivers[i & 3];
    sum += object.value + object.method() + object.computed + (object.missing === undefined ? 0 : 1000);
  }
  for (const object of make()) {
    object.added = 1;
    sum += object.added;
  }
  return sum;
}
let sum = 0;
for (let i = 0; i < 6; i++) sum += round();
${numbers.map(number => `${give(number)} sum += round();`).join("\n")}
console.log(sum);
`;

const programs: Record<string, string> = {
  "by-name.cjs": program(number => `chain[${number % 6}].unrelated${number} = ${number};`),
  "by-key.cjs": program(number => `chain[${number % 6}]["unrelated" + ${number}] = ${number};`),
  "by-definition.cjs": program(
    number =>
      `Object.defineProperty(chain[${number % 6}], "unrelated${number}", { value: ${number}, writable: true, enumerable: true, configurable: true });`,
  ),
};

test.each(Object.keys(programs))(
  "what is cached under the names that are read outlives the names that a prototype is given: %s",
  async entry => {
    using dir = tempDir("aot-a-name-given-to-a-prototype", programs);
    const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", "--aot-heat=none", entry, "--outfile", executable],
      String(dir),
    );
    expect({
      stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
      exitCode: built.exitCode,
    }).toEqual({ stderr: [], exitCode: 0 });
    const counts = join(String(dir), "counts.txt");
    const ran = await run([executable], String(dir), { ...bunEnv, [runtimeEnvironment.countsPath]: counts });
    expect({ stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(Number(ran.stdout)).toBe((numberOfNames + 6) * (16 * 111 + 4));
    let timesAsked = 0;
    for (const line of readFileSync(counts, "utf8").split("\n")) {
      const [times, what] = line.split("\t");
      if (/^operation:operationAOT(GetByIdAndCache|PutByIdAndCache|FillSiteCache)$/.test(what))
        timesAsked += Number(times);
    }
    expect(timesAsked).toBeGreaterThan(0);
    expect(timesAsked).toBeLessThan(numberOfNames);
  },
  240_000,
);
