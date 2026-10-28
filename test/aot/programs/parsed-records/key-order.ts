const leak = new Function("value", process.argv.length > 99 ? "" : "return value");
function parse(text: string, reviver?: any): any {
  return JSON.parse(text, reviver);
}
interface Point { x: number; y: number; label?: string }
function describe(point: Point): string {
  return `${point.x},${point.y},${point.label ?? "-"}`;
}
function show(text: string) {
  const value = parse(text);
  console.log(describe(value), Object.keys(value).join(), JSON.stringify(value));
  for (const key in value) console.log(key, value[key]);
  console.log(Object.entries(value).flat().join("|"), JSON.stringify({ ...value }), JSON.stringify(Object.assign({}, value)));
}
leak({ x: 0, y: 0, label: "" } satisfies Point);
console.log(describe({ x: 1, y: 2 }), describe({ x: 1, y: 2, label: "a" }));
for (let round = 0; round < 3; round++) {
  show('{"x":1,"y":2}');
  show('{"y":2,"x":1}');
  show('{"x":1,"y":2,"label":"a"}');
  show('{"label":"a","x":1,"y":2}');
  show('{"x":1,"label":"a","y":2}');
  show('{"y":2,"label":"a","x":1}');
  show(' { "x" : 1 , "y" : 2 } ');
  show('{"\\u0078":1,"y":2}');
}
export {};
