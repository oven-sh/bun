// `typeof` of a name with a `--define` value is evaluated where its answer is compared, where a logical operator takes it as a value, and in the test of a loop and of `switch`: above the declaration of the `let` that the value names, each throws.
// Flags: --define NAME=target
function attempt(read) {
  try {
    return read();
  } catch (error) {
    return error.constructor.name;
  }
}
console.log(
  attempt(() => (typeof NAME === "number" ? "a number" : "no number")),
  attempt(() => typeof NAME && "and"),
  attempt(() => typeof NAME || "or"),
  attempt(() => typeof NAME ?? "nullish"),
  attempt(() => {
    while (typeof NAME) return "while";
  }),
  attempt(() => {
    for (; typeof NAME;) return "for";
  }),
  attempt(() => {
    switch (typeof NAME) {
      default:
        return "switch";
    }
  }),
);
let target = 1;
console.log(typeof NAME === "number" ? "a number" : "no number", typeof NAME && "and", typeof NAME || "or");
