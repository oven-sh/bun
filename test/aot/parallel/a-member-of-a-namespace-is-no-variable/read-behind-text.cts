namespace Box {
  export var size = "member";
  export function peek(code: string): string { eval(code); return size; }
}
console.log(Box.peek("var size = 'caught'"), Box.peek("0"));
