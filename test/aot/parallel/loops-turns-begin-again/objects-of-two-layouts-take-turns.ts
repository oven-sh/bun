// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
interface Shape { area(): number }
class Square implements Shape { constructor(public side: number) {} area() { return this.side * this.side; } }
class Disk implements Shape { constructor(public radius: number) {} area() { return 3 * this.radius * this.radius; } }
function run(shapes: Shape[]): number {
  let total = 0;
  for (let i = 0; i < shapes.length; i++) total += shapes[i].area();
  return total;
}
function main() {
  const shapes: Shape[] = [];
  for (let i = 0; i < 300; i++) shapes.push(i % 2 ? new Square(i) : new Disk(i));
  shapes[200] = { area: () => 1 };
  (globalThis as any).shapes = shapes;
  (0, eval)("1");
  console.log(run(shapes));
}
main();
