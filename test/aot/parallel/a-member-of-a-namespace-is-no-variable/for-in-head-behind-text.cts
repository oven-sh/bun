namespace Box {
  export var key = "none";
  export function last(code: string, o: object): string { eval(code); for (key in o); return Box.key; }
}
console.log(Box.last("var key = 'text'", { p: 1, q: 2 }), Box.key);
