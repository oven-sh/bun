const say = (...a: any[]) => console.log(...a.map(x => typeof x === "function" ? x.toString() : x));
interface Op { name: string; op: string; }
const ops: Op[] = [{ name: "add", op: "+" }, { name: "sub", op: "-" }];
class Vector {
  constructor(public x: number, public y: number) {}
  [key: string]: any;
}
function install(target: any): void {
  const template = "(function NAME(v) { return new Vector(this.x OP v.x, this.y OP v.y); })";
  for (const { name, op } of ops) target[name] = eval(template.replace("NAME", name).replace(/OP/g, op)) as any;
}
install(Vector.prototype);
const v = new Vector(1, 2).add(new Vector(3, 4)).sub(new Vector(1, 1)) as Vector;
say(v.x, v.y, v.add, v.sub.length);
const n: number = eval("(function (a, b) { return a * b; })")(3, 4); say(n + 1);
enum E { A, B }
say(eval("(function () { return E.B; })")());
