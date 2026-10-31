import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import type { GeneratedInputsCheck } from "./emit.ts";

const check: GeneratedInputsCheck = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const failures: string[] = [];

for (const crate of check.crates) {
  if (crate.reads === "all") continue;
  const read = new Set<string>();
  for (const line of readFileSync(crate.depInfo, "utf8").split("\n")) {
    if (line.startsWith("#")) continue;
    const rule = /^.*?: (.*)$/.exec(line);
    for (const escaped of rule?.[1]?.match(/(?:\\ |[^ ])+/g) ?? []) {
      const path = relative(check.directory, escaped.replace(/\\ /g, " "));
      if (!path.startsWith("..") && !/^([a-zA-Z]:|[\\/])/.test(path)) read.add(path.split(sep).join("/"));
    }
  }
  for (const path of read) {
    const isListed = crate.reads.some(entry => (entry.endsWith("/") ? path.startsWith(entry) : path === entry));
    if (!isListed) failures.push(`${crate.name} reads ${path}`);
  }
}

if (failures.length > 0) {
  console.error(
    `${failures.join("\n")}\nA crate is compiled once the generated files listed for it exist. Add these to generatedFilesReadBy in scripts/build/rust.ts.`,
  );
  process.exit(1);
}
