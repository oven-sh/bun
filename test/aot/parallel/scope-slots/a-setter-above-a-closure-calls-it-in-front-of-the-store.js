// The same for a store under a name, and under a computed key.
const said = [];
for (const key of ["late", "later"]) {
  Object.defineProperty(Function.prototype, key, {
    set(value) {
      try {
        said.push(value + " " + this());
      } catch (error) {
        said.push(value + " " + error.name);
      }
    },
  });
}
function make(key) {
  const read = () => limit.n;
  read.late = "by name";
  read[key] = "by key";
  const limit = { n: 5 };
  read.late = "behind";
  return read;
}
console.log(make("later")(), said.join());
