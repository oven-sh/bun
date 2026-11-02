// Where code may come from disk, a name that the build does not know may find any file, and then nothing about the program is known.
// A for..of over a Set hands its body what the Set holds and never the undefined of the step that finds the end,
// so the build knows both names here and the executable holds those two modules of the library and little else.
// Flags: --aot-allow-code-from-disk
// STATISTIC: ImageFunctionsEmitted <= 400
// STATISTIC: FlowEdgesLogged <= 30000
const names = new Set<string>();
names.add("os");
names.add("path");
const kinds: string[] = [];
for (const name of names) {
  const loaded = await import(name);
  kinds.push(`${name}: ${typeof loaded.platform} ${typeof loaded.join}`);
}
console.log(kinds.join("\n"));
