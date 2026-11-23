// Files that only `import(name)` with a name made at run time reaches: the run time starts each of them. Order of evaluation, one evaluation a file, files in a ring, a file that throws while it loads.
const log: string[] = (globalThis as any).log = [];
const names = ["first", "second", "ring-a", "third", "first", "ring-b", "throws", "throws", "second"];
for (let turn = 0; turn < names.length; turn++) {
  const name = "./" + names[turn] + ".ts";
  try {
    const loaded = await import(name);
    log.push("loaded " + names[turn] + " " + Object.keys(loaded).sort().join() + " " + (typeof loaded.value === "function" ? "a function that gives " + loaded.value() : String(loaded.value)));
  } catch (e) {
    log.push("failed " + names[turn] + " " + (e as Error).message);
  }
}
console.log(log.join("\n"));
