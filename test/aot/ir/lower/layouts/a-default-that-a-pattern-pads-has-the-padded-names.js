// RUN: link
// CHECK: layout {{*}}fields=[{key="bold" declared={type=undefined|boolean flags=[IsExpected]}}, {key="color" declared={type=undefined|null|string flags=[IsExpected]}}]

// The default `{}` is destructured by a pattern that has defaults of its own. The checker pads its type with those members, `color` and `bold`, each with the type of its default. That type bears the literal's symbol, and it is no type of the literal: it has names that the literal does not write. It says what they hold, as any type that is computed does.
function paint({ style: { color = "none", bold = false } = {} } = {}) {
  return color.length + (bold ? 1 : 0);
}
console.log(paint({ style: { bold: true } }) + paint({ style: { color: "red" } }) + paint());
