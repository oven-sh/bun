// Evaluated text is one more writer of the variables it can see, and no type holds it back.
let count: number = 1;
let label: string = "one";
let on: boolean = true;
let point: { x: number; y: number } = { x: 1, y: 2 };
let callback: (value: number) => number = value => value + 1;

function describe(): string {
  return [typeof count, String(count), typeof label, String(label), typeof on, String(on), typeof point, JSON.stringify(point), typeof callback].join(" ");
}
function inner(): string {
  let total: number = 10;
  let name: string = "inner";
  let box: { value: number } = { value: 3 };
  const read = () => [typeof total, String(total), typeof name, String(name), JSON.stringify(box)].join(" ");
  const lines = [read()];
  eval("total = 'text'; name = 5; box = null");
  lines.push(read());
  eval("total = -0; name = undefined; box = [1]");
  lines.push(read() + " " + Object.is(total, -0));
  eval("total = 2 ** 31; name = 'back'; box = { value: 4 }");
  lines.push(read() + " " + (total + 1) + " " + name.length + " " + box.value);
  return lines.join("\n");
}
console.log(describe());
eval("count = 'text'; label = 7; on = null; point = 'none'; callback = 3");
console.log(describe());
eval("count = 0.5; label = undefined; on = 1; point = [1, 2]; callback = { call: 1 }");
console.log(describe());
eval("count = 3; label = 'three'; on = false; point = { x: 3, y: 4 }; callback = value => value * 2");
console.log(describe(), count + 1, label.length, point.x + point.y, callback(4));
console.log(inner());
