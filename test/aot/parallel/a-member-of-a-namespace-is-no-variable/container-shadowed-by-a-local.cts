// A local variable is named like the namespace around it. Plain Bun prints another output.
// Its transpiler writes `size` as `Box.size` and leaves the names as they are, so the local takes the name. In an ordinary executable the bundler has given the parameter that holds the object of the namespace a name of its own, and this is what such an executable prints, and what tsc's emit prints.
namespace Box {
  export var size = "member";
  export function peek() { var Box = { size: "local" }; return size + " " + Box.size; }
}
console.log(Box.peek());
/* Output:
member local
*/
