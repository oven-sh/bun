// `list[i].kind` over what JSON.parse made, under names that literals of the program have too. In a hot loop the read is asked of the run time's tables in line, which is four times the
// code of the call. In a large program some layout has nearly every name, so in a function that is cold the read stays a call, loop or no loop: one application held 586 KB of such reads.
import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { run } from "./harness/run";
import { test } from "./supported";

const main = `const shapes = [];
for (let i = 0; i < 8; i++) shapes.push(i % 3 ? { kind: "circle", radius: i + 0.5 } : { kind: "square", side: i + 0.25 });
function area(shape) {
  return shape.kind === "circle" ? shape.radius * shape.radius * 3 : shape.side * shape.side;
}
function describe(text) {
  const shape = JSON.parse(text);
  return shape.kind + ":" + shape.radius + ":" + shape.side;
}
function describeAll(text) {
  const list = JSON.parse(text);
  let out = "";
  for (let i = 0; i < list.length; i++) out += list[i].kind + ":" + list[i].radius + ":" + list[i].side + ";";
  return out;
}
function onRareDays(day, text) {
  if (day === 1) return describe(text);
  if (day === 2) return describeAll("[" + text + "]");
  return "";
}
let sum = 0;
for (const shape of shapes) sum += area(shape);
console.log(sum, onRareDays(process.argv.length - 1, '{"kind":"circle","radius":2}'), onRareDays(process.argv.length, '{"kind":"square","side":3}'));
`;

// The bytes are x64's.
test.skipIf(process.arch !== "x64")(
  "three reads of parsed data in a loop of a cold function take the code of three calls",
  async () => {
    using dir = tempDir("aot-cold-reads-of-parsed-data", { "main.js": main });
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
    expect((await run([executable], cwd)).stdout).toBe("395.4375 circle:2:undefined square:undefined:3;\n");

    // F: a function with its number, name and band of heat. O: the bytes of each operation in the function of that number.
    const lines = readFileSync(map, "utf8")
      .split("\n")
      .map(line => line.split("\t"));
    const describeAll = lines.find(fields => fields[0] === "F" && fields[7] === "describeAll")!;
    expect(describeAll[12]).toBe("c");
    const sizes = lines.find(fields => fields[0] === "O" && fields[1] === describeAll[1])!;
    const bytesOfReads = Number(sizes[sizes.indexOf("PropGet") + 1]);
    expect(bytesOfReads).toBeGreaterThan(0);
    // A call takes 44 bytes on x64, the form in line 189.
    expect(bytesOfReads / 3).toBeLessThan(80);
  },
  240_000,
);
