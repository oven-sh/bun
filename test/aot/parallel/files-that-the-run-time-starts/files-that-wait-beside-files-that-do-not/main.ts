// A file that awaits at its top level is entered by another road than one that does not: both kinds, reached by names made at run time, in one program.
const log: string[] = (globalThis as any).log = [];
const names = ["waits", "plain", "over-waits", "plain", "waits"];
for (let turn = 0; turn < names.length; turn++) {
  const loaded = await import("./" + names[turn] + ".ts");
  log.push("loaded " + names[turn] + " " + String(loaded.value));
}
console.log(log.join("\n"));
