namespace Box {
  export var size = "member";
  export function kind(code: string): string { eval(code); return typeof size; }
}
console.log(Box.kind("var size = 5"), Box.kind("0"));
