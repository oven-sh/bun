// A proxy stands above a closure, and its trap keeps the receiver of a read. The closure is named through what was kept, every other time. Each line: the name in the first frame of the closure.
const firstFrame = stack =>
  stack
    .split("\n")[1]
    .trim()
    .replace(/ ?\(.*\)$/, "");
let kept;
const above = new Proxy(Function.prototype, {
  get(target, key, receiver) {
    if (key === "tag") kept = receiver;
    return Reflect.get(target, key, receiver);
  },
  set(target, key, value, receiver) {
    kept = receiver;
    return true;
  },
});
function rename(f, name) {
  if (name) Object.defineProperty(f, "name", { value: name });
}
for (const name of ["first", "", "second", ""]) {
  const f = function written() {
    return new Error("x").stack;
  };
  Object.setPrototypeOf(f, above);
  f.tag;
  rename(kept, name);
  console.log("kept by the trap of a read |", firstFrame(f()));
}
for (const name of ["first", "", "second", ""]) {
  const f = function written() {
    return new Error("x").stack;
  };
  Object.setPrototypeOf(f, above);
  f.tag = 1;
  rename(kept, name);
  console.log("kept by the trap of a store |", firstFrame(f()));
}
