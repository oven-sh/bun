// Flags: --aot-allow-code-from-disk
// STATISTIC: ImageFunctionsEmitted <= 400
// STATISTIC: FactEdges <= 30000 Todo: much of Bun's library comes in where code may come from disk
const kinds: string[] = [];
for (const name of ["os", "path"]) {
  const loaded = await import(name);
  kinds.push(`${name}: ${typeof loaded.platform} ${typeof loaded.join}`);
}
const names = new Set<string>(["path", "os"]);
for (const name of names) {
  const loaded = await import(name);
  kinds.push(`${name}: ${typeof loaded.platform} ${typeof loaded.join}`);
}
for (const name of [...names, "os"]) {
  const loaded = await import(name);
  kinds.push(`${name}: ${typeof loaded.platform} ${typeof loaded.join}`);
}
console.log(kinds.join("\n"));
