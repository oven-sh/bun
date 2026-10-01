const P = "/workspace/notes/lint/units/conformance/enumerator/prototype/";
const { enumerateInstances } = await import(P + "compiler_runner.ts");
const e = enumerateInstances({ casesRoot: "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases" });
const stems = new Map<string, string[]>();
for (const i of e.instances) { const s = i.name.replace(/\.tsx?$/, ".errors.txt").toLowerCase(); stems.set(s, [...(stems.get(s) ?? []), i.suite + "/" + i.name]); }
console.log("instances", e.instances.length, "baseline names ignoring case", stems.size, [...stems.values()].filter(v => v.length > 1).slice(0, 5));
const ext = new Map<string, number>();
for (const i of e.instances) { const x = i.name.slice(i.name.lastIndexOf(".")); ext.set(x, (ext.get(x) ?? 0) + 1); }
console.log("extensions of instance names", JSON.stringify([...ext]));
