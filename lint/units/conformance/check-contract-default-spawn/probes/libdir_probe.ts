import { buildInput } from "../prototype/run";
const P = new URL("../../enumerator/prototype/", import.meta.url).pathname;
const { enumerateInstances } = await import(P + "compiler_runner.ts");
const { readFile } = await import(P + "vfs.ts");
const casesRoot = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const e = enumerateInstances({ casesRoot });
let include = 0, onlyOther: string[] = [], libFilesOption = 0, jsonRoots = 0, noProgramRoot: string[] = [];
const used: Record<string, number> = {};
for (const i of e.instances) {
  if (i.status !== "run") continue;
  const file = casesRoot + "/" + i.casePath;
  const input = buildInput(i, readFile(file).contents, file);
  if (typeof input === "string") continue;
  const inRoots = input.roots.some(u => u.content.includes("/.lib/"));
  const inOthers = input.otherFiles.some(u => u.content.includes("/.lib/"));
  if (inRoots) include++;
  else if (inOthers) onlyOther.push(i.name);
  if (i.config?.has("libfiles")) libFilesOption++;
  for (const u of [...input.roots, ...input.otherFiles]) for (const m of u.content.matchAll(/\/\.lib\/([A-Za-z0-9_.\/-]+)/g)) used[m[1]] = (used[m[1]] ?? 0) + 1;
  const program = input.roots.filter(u => !u.name.endsWith(".json") && !u.name.endsWith(".tsbuildinfo"));
  if (program.length !== input.roots.length) jsonRoots++;
  if (program.length === 0) noProgramRoot.push(i.name);
}
console.log(JSON.stringify({ includeLibDir: include, mentionedOnlyInOtherFiles: onlyOther, libFilesOption, instancesWithJsonRoots: jsonRoots, noProgramRoot, used }, null, 1));
