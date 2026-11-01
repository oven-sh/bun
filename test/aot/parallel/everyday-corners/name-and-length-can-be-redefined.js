// Name and length can be redefined: compiled answers as plain. A plain store to `name` throws in strict code.
function f(a) {}
Object.defineProperty(f, "name", { value: "renamed" });
Object.defineProperty(f, "length", { value: 9 });
try {
  f.name = "ignored";
  console.log("stored");
} catch (e) {
  console.log(e.constructor.name);
}
console.log(f.name, f.length, f.bind(null, 1).length, f.bind().name);
