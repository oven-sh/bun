// A store to the name of a namespace from outside its block. The code of the block goes on with the object that the block was entered with: what runs holds it in a parameter of the function around the block.
// Todo: a block has no binding of its own for its object, so its code reads the variable that the store has changed, and prints "another object"
namespace Box {
  export var size = "member";
  export function peek() { return size; }
}
const peek = Box.peek;
// @ts-ignore
Box = { size: "another object" };
console.log(peek());
