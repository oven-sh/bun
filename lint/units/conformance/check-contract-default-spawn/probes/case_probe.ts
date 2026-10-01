import { buildInput } from "../prototype/run";
const P = new URL("../../enumerator/prototype/", import.meta.url).pathname;
const { enumerateInstances } = await import(P + "compiler_runner.ts");
const { readFile } = await import(P + "vfs.ts");
const casesRoot = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const e = enumerateInstances({ casesRoot });
let collide: string[] = [], insensitive: string[] = [], winUnsafe: string[] = [], longName: string[] = [];
for (const i of e.instances) {
  if (i.status !== "run") continue;
  const file = casesRoot + "/" + i.casePath;
  const input = buildInput(i, readFile(file).contents, file);
  if (typeof input === "string") continue;
  const spell = new Map<string, string>();
  let c = false, w = false;
  for (const u of [...input.roots, ...input.otherFiles, ...[...input.links.keys()].map(name => ({ name }))]) {
    const parts = u.name.split("/");
    for (let k = 2; k <= parts.length; k++) {
      const prefix = parts.slice(0, k).join("/");
      const lower = prefix.toLowerCase();
      const had = spell.get(lower);
      if (had !== undefined && had !== prefix) c = true;
      spell.set(lower, prefix);
    }
    if (parts.some(p => /[<>:"|?*\\]/.test(p) || /[. ]$/.test(p) && p !== "." && p !== ".." || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(p))) w = true;
    if (parts.some(p => Buffer.byteLength(p) > 200)) longName.push(i.name);
  }
  if (c) collide.push(i.name);
  if (w) winUnsafe.push(i.name);
  const v = i.config?.get("usecasesensitivefilenames");
  if (v !== undefined) insensitive.push(i.name + "=" + v);
}
console.log(JSON.stringify({ caseCollisions: collide.length, collide: collide.slice(0, 20), useCaseSensitiveFileNames: insensitive, windowsUnsafeNames: winUnsafe.length, winUnsafe: winUnsafe.slice(0, 12), longName }, null, 1));
