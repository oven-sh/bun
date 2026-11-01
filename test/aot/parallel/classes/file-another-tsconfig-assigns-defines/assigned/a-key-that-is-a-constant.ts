const KEY = "name";
class Above {}
Object.defineProperty(Above.prototype, "y", {
  set(value: unknown) {
    console.log(
      "a folder that says assigned, beside a key that is a constant: the setter of the class above ran with",
      value,
    );
  },
  configurable: true,
});
class Below extends Above {
  [KEY] = 1;
  y = 2;
  optional?: number;
}
console.log(
  "a folder that says assigned, beside a key that is a constant: own keys:",
  Object.keys(new Below()).join(" ") || "none",
);
export {};
