namespace Box {
  export var a = "a", b = "b";
  export function take(code: string): string { eval(code); [a] = ["listed"]; ({ b } = { b: "named" }); return a + " " + b; }
}
console.log(Box.take("var a = 1, b = 2"), Box.a, Box.b);
