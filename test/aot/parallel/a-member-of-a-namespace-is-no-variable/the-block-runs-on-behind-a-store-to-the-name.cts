// Reference: bun build --compile
// The bundler gives the parameter that holds the object a name of its own, so the name of the namespace is the variable also in the block. `bun run` leaves the parameter its name.
namespace Box {
  export var size = "member";
  // @ts-ignore
  Box = { size: "another object" };
  export var depth = size;
  export function self() { return Box; }
}
console.log(JSON.stringify(Box));
