namespace Box {
  eval("var size = 'text'");
  export var size = "member";
  export const seen = eval("size");
}
console.log(Box.size, Box.seen);
