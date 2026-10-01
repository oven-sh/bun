// usage: bun e3.ts <H> [rounds]: enumerateInstances of H/runner/compiler_runner.ts on H/corpus/cases, with the meters of one pass each.
import { createHash } from "node:crypto";
import { join } from "node:path";
import { read, delta } from "./meter";
const home = process.argv[2];
const rounds = Number(process.argv[3] ?? 3);
const { enumerateInstances } = await import(join(home, "runner/compiler_runner"));
for (let k = 0; k < rounds; k++) {
  const a = read();
  const instances = enumerateInstances(join(home, "corpus/cases"));
  const b = read();
  const text = instances.map((i: any) => `${i.name}\t${i.testName}\t${i.suite}\t${i.file}\t${i.configName}\t${i.status}\t${i.skipReason ?? ""}\t${i.invalidReason ?? ""}\t${i.emitOnly}\t${i.notes.join("|")}\t${i.config === undefined ? "-" : [...i.config].map(([k, v]: [string, string]) => `${k}=${v}`).join(";")}\n`).join("");
  console.log(`${k} n=${instances.length} all fields sha256 ${createHash("sha256").update(text).digest("hex").slice(0, 16)} ${delta(a, b)}`);
}
