// The exports of a CommonJS file hold a member that a written descriptor fixes; a get trap over them may answer nothing else for it.
Object.defineProperty(exports, "fixed", { value: 1 });
exports.free = 2;
const watched = new Proxy(exports, {
  get(target, key) {
    return key === "fixed" || key === "free" ? 7 : target[key];
  },
});
for (const key of ["fixed", "free", "absent"]) {
  for (let turn = 0; turn < 3; turn++) {
    try {
      console.log(key, turn, String(watched[key]));
    } catch (error) {
      console.log(key, turn, error.name);
    }
  }
}
try {
  console.log("by name", watched.fixed);
} catch (error) {
  console.log("by name", error.name);
}
console.log("by name", watched.free);
