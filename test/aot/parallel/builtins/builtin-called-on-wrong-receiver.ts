// Methods of built-in prototypes are called on receivers of other kinds.
const attempt = (f: () => unknown) => {
  try {
    return String(f());
  } catch (e) {
    return (e as Error).constructor.name;
  }
};
console.log(
  [
    attempt(() => Array.prototype.shift.call("abc")),
    attempt(() => Array.prototype.join.call({ length: 2, 0: "a", 1: "b" }, "-")),
    attempt(() => String.prototype.trim.call(123)),
    attempt(() => Map.prototype.get.call({}, 1)),
    attempt(() => Date.prototype.getTime.call({})),
    attempt(() => Array.prototype.shift.call([5, 6])),
  ].join(" "),
);
