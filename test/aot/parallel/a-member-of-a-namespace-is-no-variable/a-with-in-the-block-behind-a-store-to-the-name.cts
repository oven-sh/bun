// The object of a `with` can take the name of the namespace. Where it does not, the object is that of the block.
namespace Box {
  export var size = "member";
  // @ts-ignore
  export function peek(over: any) { with (over) { return size; } }
}
const peek = Box.peek;
// @ts-ignore
Box = { size: "another object" };
console.log(peek({}), peek({ Box: { size: "of the with" } }), peek({ size: "no variable" }));
