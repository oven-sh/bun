class Above {}
Object.defineProperty(Above.prototype, "y", {
  set(value: unknown) {
    console.log("a folder that says assigned: the setter of the class above ran with", value);
  },
  configurable: true,
});
class Below extends Above {
  y = 2;
  optional?: number;
}
console.log("a folder that says assigned: own keys:", Object.keys(new Below()).join(" ") || "none");
export {};
