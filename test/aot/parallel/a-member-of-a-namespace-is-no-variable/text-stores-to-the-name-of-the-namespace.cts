namespace Box {
  export var size = "member";
  export function peek() { return size; }
}
const peek = Box.peek;
eval("Box = { size: 'another object' }");
console.log(peek(), Box.size);
