// Object.assign throws at the first member of `process`, because the target is frozen. The keys of `process` are listed in the same order afterwards as in plain Bun.
// Alone: the order of the keys of `process` follows from which members were read first, and the other programs of a joined executable read some
for (const key of Object.keys(process)) {
  try {
    void process[key];
  } catch {}
}
let copy = Object.freeze({});
try {
  Object.assign(copy, process);
} catch {}
const inLoop = [];
for (const key in process) inLoop.push(key);
console.log(Object.keys(copy).length > 0, inLoop.join(" "));
console.log(Object.keys(process).join(" "));
console.log(Reflect.ownKeys(process).map(String).join(" "));
