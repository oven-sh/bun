// A definition without a value makes `constructor` of the object under `prototype` of a function enumerable. Object.values() of the object then lists the function.
function F() {
  return "called";
}
Object.defineProperty(F.prototype, "constructor", { enumerable: true });
console.log(
  Object.values(F.prototype)
    .map(v => typeof v + (typeof v === "function" ? v() : ""))
    .join(),
);
console.log(
  Object.values({ ...F.prototype })
    .map(v => typeof v + (typeof v === "function" ? v() : ""))
    .join(),
);
