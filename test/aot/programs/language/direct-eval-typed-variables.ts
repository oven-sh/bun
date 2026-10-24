// A store from the text of a direct eval is tested against the type the variable was declared with.
let moduleNumber: number = 1;

function report(label: string, run: () => unknown): void {
  try {
    console.log(label, String(run()));
  } catch (error) {
    console.log(label, String(error));
  }
}

report("module variable, number", () => eval("moduleNumber = 2"));
report("module variable, string", () => eval("moduleNumber = 'a'"));
console.log(typeof moduleNumber, moduleNumber);

function storesLocal(): string {
  let count: number = 1;
  report("local variable, number", () => eval("count = 3"));
  report("local variable, string", () => eval("count = 'b'"));
  return typeof count + " " + count;
}
console.log(storesLocal());

function storesString(): string {
  let text: string = "a";
  report("string variable, string", () => eval("text = 'c'"));
  report("string variable, number", () => eval("text = 1"));
  report("string variable, object", () => eval("text = {}"));
  const length = text.length;
  report("string variable, null", () => eval("text = null"));
  return length + " " + text;
}
console.log(storesString());

class Point {
  x: number = 1;
}
function storesObject(): number {
  let point: Point = new Point();
  report("class variable, string", () => eval("point = 'd'"));
  report("class variable, object", () => eval("point = { x: 2 }; point.x"));
  return point.x;
}
console.log(storesObject());
