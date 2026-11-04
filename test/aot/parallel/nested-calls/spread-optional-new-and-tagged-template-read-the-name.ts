function outer(list: number[]) {
  const sum = (...xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const Point = function (this: { x: number }, x: number) { this.x = x; } as unknown as new (x: number) => { x: number };
  const tag = (s: TemplateStringsArray, v: number) => s.join("|") + v;
  return [sum(...list), sum?.(1, 2), new Point(4).x, tag`a${1}b`, sum(1, 2, 3)].join(",");
}
console.log(outer([5, 6]));
