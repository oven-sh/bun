// Verifies the port of the roots and other files split against the order of the file sections of every oracle baseline.
const P = new URL("../../enumerator/prototype/", import.meta.url).pathname;
const { enumerateInstances } = await import(P + "compiler_runner.ts");
const { makeUnitsFromTest, srcFolder } = await import(P + "test_case_parser.ts");
const { getNormalizedAbsolutePath } = await import(P + "tspath.ts");
const { readFile } = await import(P + "vfs.ts");
import { existsSync, readFileSync } from "node:fs";

const casesRoot = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const baselines = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";
const requireStr = "require(";
const referencesRegex = /reference[\t\n\f\r ]path/;
const replacer = /\/\.ts\/|\/\.lib\/|\/\.src\/|bundled:\/\/\/libs\/|file:\/\/\/\.\/ts\/|file:\/\/\/\.\/lib\/|file:\/\/\/\.\/src\//g;
const strip = (s: string) => s.replace(replacer, m => (m.startsWith("file:") ? "file:///" : ""));
const e = enumerateInstances({ casesRoot });
let checked = 0, same = 0, tsconfig = 0, tsconfigSame = 0, pretty = 0;
const bad: string[] = [];
const tsconfigBad: string[] = [];
for (const i of e.instances) {
  if (i.status !== "run") continue;
  const oracle = baselines + "/" + i.suite + "/" + i.name.replace(/\.tsx?$/, ".errors.txt");
  if (!existsSync(oracle)) continue;
  const text = readFileSync(oracle, "latin1");
  const headers = [...text.matchAll(/(?:^|\r\n)==== (.*) \((\d+) errors\) ====(?=\r\n|$)/g)].map(m => m[1]);
  const file = casesRoot + "/" + i.casePath;
  const made = makeUnitsFromTest(readFile(file).contents, file);
  if (!made.ok) { bad.push(i.name + ": units"); continue; }
  const t = made.value;
  const config: Map<string, string> | undefined = i.config;
  const currentDirectory = getNormalizedAbsolutePath(config?.get("currentdirectory") ?? "", srcFolder);
  const name = (u: any) => Buffer.from(strip(getNormalizedAbsolutePath(u.name, currentDirectory)), "utf8").toString("latin1");
  const units = t.testUnitData;
  let order: string[];
  if (t.tsConfigFileUnitData !== undefined) {
    tsconfig++;
    // without the file list of the configuration: every unit is an other file
    order = [name(t.tsConfigFileUnitData), ...units.map(name)];
    const a = JSON.stringify(order), b = JSON.stringify(headers);
    if (a === b) tsconfigSame++; else tsconfigBad.push(i.name + "\n    expected " + b + "\n    units    " + a);
    continue;
  }
  const last = units[units.length - 1];
  if ((config?.get("noimplicitreferences") ?? "") !== "" || last.content.includes(requireStr) || referencesRegex.test(last.content)) {
    order = [name(last), ...units.slice(0, -1).map(name)];
  } else {
    order = units.map(name);
  }
  checked++;
  if (text.startsWith("\x1b[")) pretty++;
  const a = JSON.stringify(order), b = JSON.stringify(headers);
  if (a === b) same++; else bad.push(i.name + "\n    expected " + b + "\n    computed " + a);
}
console.log(JSON.stringify({ checked, same, pretty, tsconfig, tsconfigSameAsUnitOrder: tsconfigSame }));
console.log(bad.slice(0, 30).join("\n"));
console.log("-- tsconfig instances whose section order is not the unit order:", tsconfigBad.length);
console.log(tsconfigBad.slice(0, 12).join("\n"));
