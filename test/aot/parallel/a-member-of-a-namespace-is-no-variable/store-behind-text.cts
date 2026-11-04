namespace Box {
  export var size = "member";
  export function put(code: string): string { eval(code); size = "stored"; return Box.size; }
}
console.log(Box.put("var size = 'caught'"), Box.size);
