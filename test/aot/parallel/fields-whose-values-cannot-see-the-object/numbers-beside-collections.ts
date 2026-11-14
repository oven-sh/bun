class Vector {
  constructor(public x: number, public y: number) {}
  plus(other: Vector) {
    return new Vector(this.x + other.x, this.y + other.y);
  }
}
class Body {
  position: Vector;
  velocity: Vector;
  trail: Vector[] = [];
  marks = new Map<number, Vector>();
  mass: number;
  onMove = (step: number) => {
    this.position = this.position.plus(this.velocity);
    if (step % 3 === 0) this.trail.push(this.position);
    this.marks.set(step, this.position);
  };
  constructor(position: Vector, velocity: Vector, mass = limits.mass) {
    this.position = position;
    this.velocity = velocity;
    this.mass = mass;
  }
}
const limits = { mass: 1.5 };
class Grid {
  cells = new Map<string, Body[]>();
  size: number;
  constructor(size: number) {
    this.size = size;
  }
  key(at: Vector) {
    return Math.floor(at.x / this.size) + ":" + Math.floor(at.y / this.size);
  }
  add(body: Body) {
    const key = this.key(body.position);
    const cell = this.cells.get(key);
    if (cell) cell.push(body);
    else this.cells.set(key, [body]);
  }
}
class World {
  grid = new Grid(limits.mass * 2);
  bodies: Body[] = [];
  elapsed = 0;
  constructor(private settings: { count: number; speed: number }, public name = "world") {
    for (let i = 0; i < settings.count; i++) this.bodies.push(new Body(new Vector(i, -i), new Vector(settings.speed, 0.5), i % 2 ? undefined : i));
  }
  step() {
    this.elapsed += this.settings.speed;
    this.grid = new Grid(3);
    for (const body of this.bodies) {
      body.onMove(Math.round(this.elapsed * 10));
      this.grid.add(body);
    }
  }
}
const world = new World({ count: 6, speed: 0.25 });
for (let i = 0; i < 40; i++) world.step();
console.log(world.name, world.elapsed, [...world.grid.cells.keys()].join(), world.bodies.map(it => [it.position.x, it.position.y, it.mass, it.trail.length, it.marks.size].join("/")).join(" "));
const odd: any[] = [new Grid(undefined as any), new Grid("3" as any), new Grid(null as any), new (Grid as any)(), new World({ count: 0, speed: NaN }, undefined), new (Body as any)()];
for (const it of odd) console.log(JSON.stringify(it), typeof it.size, it.size, it.name, it.mass, it.position);
console.log(odd.slice(0, 4).map(it => it.key(new Vector(7, 8))).join());
