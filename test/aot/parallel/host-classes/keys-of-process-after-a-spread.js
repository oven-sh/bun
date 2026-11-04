// A spread copies every member of `process`. The keys of `process` are listed in the same order afterwards as in plain Bun.
for (const key of Object.keys(process)) {
  try {
    void process[key];
  } catch {}
}
const copy = { ...process };
const inLoop = [];
for (const key in process) inLoop.push(key);
console.log(Object.keys(copy).length > 0, inLoop.join(" "));
console.log(Object.keys(process).join(" "));
console.log(Reflect.ownKeys(process).map(String).join(" "));
