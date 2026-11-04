namespace N {
  export var x = 1, y = 2;
  // @ts-ignore
  export function under(o: object) { with (o) { return delete x; } }
  // @ts-ignore
  export function behind(code: string) { eval(code); return delete y; }
}
const o = { x: "kept" };
console.log(N.under(o), "x" in o, "x" in N, N.behind("var y = 5"), "y" in N);
