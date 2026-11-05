// A program looks with Bun.Glob for the files of a folder beside it and loads each. An executable holds those files as compiled code.
const found = (pattern, options) =>
  [...new Bun.Glob(pattern).scanSync(options)].map(file => file.replaceAll("\\", "/")).sort();

for (const file of found("commands/*.mjs", import.meta.dir)) console.log(file, (await import("./" + file)).default);
for (const file of found("**/*.mjs", { cwd: import.meta.dir + "/commands" }))
  console.log(file, (await import("./commands/" + file)).default);
console.log(found("*", { cwd: import.meta.dir + "/commands", onlyFiles: false }).join(" "));
try {
  found("*.mjs", { cwd: import.meta.dir + "/commands/absent" });
} catch (error) {
  console.log(error.code);
}

const later = [];
for await (const file of new Bun.Glob("deeper/*").scan({ cwd: import.meta.dir + "/commands" }))
  later.push(file.replaceAll("\\", "/"));
console.log(later.join(" "));
