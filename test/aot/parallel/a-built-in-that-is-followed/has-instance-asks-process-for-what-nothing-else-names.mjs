// `process instanceof Kind` calls Kind[Symbol.hasInstance](process): the method is code of the program, and what it asks of its operand is in the executable.
class Kind {
  static [Symbol.hasInstance](value) {
    return typeof value.allowedNodeEnvironmentFlags.has === "function";
  }
}
const held = process;
console.log(process instanceof Kind, held instanceof Kind);
switch (true) {
  case process instanceof Kind:
    console.log("in a case");
}
