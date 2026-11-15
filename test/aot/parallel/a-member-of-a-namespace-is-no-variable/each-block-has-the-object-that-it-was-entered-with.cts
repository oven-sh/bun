// Two blocks of one namespace with a store to the name between them, and a block in a block.
namespace Box {
  export var size = "first";
  export function peek() { return size; }
}
const peek = Box.peek;
// @ts-ignore
Box = { size: "second" };
namespace Box {
  export function look() { return size; }
}
console.log(peek(), Box.look(), "peek" in Box);

namespace Outer {
  export var depth = "outer";
  export namespace Inner {
    export var size = "inner";
    export function read() { return size + " " + depth; }
  }
  // @ts-ignore
  export function swap() { Inner = { size: "another object" }; }
  export function inner() { return Inner.size; }
}
const read = Outer.Inner.read, inner = Outer.inner;
Outer.swap();
console.log(read(), inner(), Outer.Inner.size);
// @ts-ignore
Outer = { depth: "another object" };
console.log(read());
