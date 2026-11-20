// Bodies, springs and walls stepped in time, collisions found by a grid, energy and events
export interface Point {
  x: number;
  y: number
}
export type Force = (body: Body, time: number) => Point;
export abstract class Body {
  static #next = 1;
  readonly id = Body.#next++;
  velocity: Point = {
    x: 0, y: 0
};
  asleep = 0;
  constructor(public position: Point, readonly mass: number, readonly bounce: number) {
  }
  abstract get radius(): number;
  abstract readonly kind: "ball" | "crate";
  get inverse() {
    return this.mass === Infinity ? 0 : 1 / this.mass;
  }
  get energy() {
    return this.mass === Infinity ? 0 : 0.5 * this.mass * (this.velocity.x ** 2 + this.velocity.y ** 2);
  }
  push(x: number, y: number) {
    this.velocity.x += x * this.inverse;
    this.velocity.y += y * this.inverse;
    this.asleep = 0;
  }
}
export class Ball extends Body {
  readonly kind = "ball";
  constructor(x: number, y: number, readonly radius: number, mass = radius * radius) {
    super({ x, y }, mass, 0.8);
  }
}
export class Crate extends Body {
  readonly kind = "crate";
  constructor(x: number, y: number, readonly half: number, mass = 4 * half * half) {
    super({ x, y }, mass, 0.3);
  }
  get radius() {
    return this.half * Math.SQRT2;
  }
}
export class Spring {
  constructor(readonly a: Body, readonly b: Body, readonly rest: number,
    readonly stiffness: number, readonly damping = 0.1) {
  }
  apply(dt: number): number {
    const dx = this.b.position.x - this.a.position.x,
      dy = this.b.position.y - this.a.position.y, d = Math.hypot(dx, dy) || 1e-9, nx = dx / d,
      ny = dy / d;
    const speed = (this.b.velocity.x - this.a.velocity.x) * nx + (this.b.velocity.y - this.a.velocity.y) * ny,
      f = (this.stiffness * (d - this.rest) + this.damping * speed) * dt;
    this.a.push(nx * f, ny * f);
    this.b.push(-nx * f, -ny * f);
    return 0.5 * this.stiffness * (d - this.rest) ** 2;
  }
}
export class Grid<T extends {
  position: Point;
  radius: number
}
> {
  readonly #cells = new Map<number, T[]>();
  constructor(readonly size: number) {
  }
  clear() {
    for (const list of this.#cells.values()) list.length = 0;
  }
  #key(cx: number, cy: number) {
    return (cx + 512) * 1024 + cy + 512;
  }
  insert(item: T) {
    const k = this.#key(Math.floor(item.position.x / this.size),
      Math.floor(item.position.y / this.size));
    const list = this.#cells.get(k);
    if (list) list.push(item);
    else this.#cells.set(k, [item]);
  }
  *pairs(): Generator<[T, T]> {
    for (const [key, list] of this.#cells) {
      if (!list.length) continue;
      const cx = Math.floor(key / 1024) - 512, cy = (key % 1024) - 512;
      for (let i = 0; i < list.length; i++) for (let k = i + 1; k < list.length; k++) yield [list[i],
        list[k]];
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        const other = this.#cells.get(this.#key(cx + dx, cy + dy));
        if (other) for (const a of list) for (const b of other) yield [a, b];
      }
    }
  }
}
export interface Contact {
  a: Body;
  b: Body;
  nx: number;
  ny: number;
  depth: number
}
export type Listener = (event: { kind: "hit"; a: number; b: number; force: number } | { kind: "sleep"; id: number }) => void;
export class World {
  readonly bodies: Body[] = [];
  readonly springs: Spring[] = [];
  readonly forces: Force[] = [];
  readonly #listeners: Listener[] = [];
  readonly #grid = new Grid<Body>(4);
  time = 0;
  contacts = 0;
  tested = 0;
  constructor(readonly width: number, readonly height: number) {
  }
  add<B extends Body>(body: B): B {
    this.bodies.push(body);
    return body;
  }
  on(l: Listener) {
    this.#listeners.push(l);
    return () => {
      this.#listeners.splice(this.#listeners.indexOf(l), 1);
  };
  }
  #tell(e: Parameters<Listener>[0]) {
    for (const l of this.#listeners) l(e);
  }
  static contact(a: Body, b: Body): Contact | null {
    const dx = b.position.x - a.position.x, dy = b.position.y - a.position.y;
    if (a instanceof Crate && b instanceof Crate) {
      const ox = a.half + b.half - Math.abs(dx), oy = a.half + b.half - Math.abs(dy);
      if (ox <= 0 || oy <= 0) return null;
      return ox < oy ? {
        a, b, nx: Math.sign(dx) || 1, ny: 0, depth: ox
    } : {
        a, b, nx: 0, ny: Math.sign(dy) || 1, depth: oy
    };
    }
    if (a instanceof Crate) {
      const px = Math.max(-a.half, Math.min(a.half, dx)), py = Math.max(-a.half,
        Math.min(a.half, dy)), ex = dx - px, ey = dy - py, d = Math.hypot(ex, ey);
      if (d >= b.radius || d === 0) return null;
      return {
        a, b, nx: ex / d, ny: ey / d, depth: b.radius - d
    };
    }
    if (b instanceof Crate) {
      const c = World.contact(b, a);
      return c && {
        a, b, nx: -c.nx, ny: -c.ny, depth: c.depth
    };
    }
    const d = Math.hypot(dx, dy), r = a.radius + b.radius;
    if (d >= r || d === 0) return null;
    return {
      a, b, nx: dx / d, ny: dy / d, depth: r - d
  };
  }
  #solve(c: Contact) {
    const {
      a, b, nx, ny
  } = c, total = a.inverse + b.inverse;
    if (total === 0) return;
    const speed = (b.velocity.x - a.velocity.x) * nx + (b.velocity.y - a.velocity.y) * ny;
    const fix = (Math.max(0, c.depth - 0.01) / total) * 0.6;
    a.position.x -= nx * fix * a.inverse;
    a.position.y -= ny * fix * a.inverse;
    b.position.x += nx * fix * b.inverse;
    b.position.y += ny * fix * b.inverse;
    if (speed > 0) return;
    const j = (-(1 + Math.min(a.bounce, b.bounce)) * speed) / total;
    a.push(-nx * j, -ny * j);
    b.push(nx * j, ny * j);
    this.contacts++;
    if (j > 5) this.#tell({ kind: "hit", a: a.id, b: b.id, force: j });
  }
  step(dt: number): number {
    let stored = 0;
    for (const b of this.bodies) {
      if (b.mass === Infinity) continue;
      for (const f of this.forces) {
        const {
          x, y
      } = f(b, this.time);
        b.velocity.x += x * dt;
        b.velocity.y += y * dt;
      }
    }
    for (const s of this.springs) stored += s.apply(dt);
    this.#grid.clear();
    for (const b of this.bodies) {
      b.position.x += b.velocity.x * dt;
      b.position.y += b.velocity.y * dt;
      for (const [axis, limit] of [["x", this.width], ["y", this.height]] as const) {
        if (b.position[axis] < b.radius) {
          b.position[axis] = b.radius;
          b.velocity[axis] = Math.abs(b.velocity[axis]) * b.bounce;
      } else if (b.position[axis] > limit - b.radius) {
          b.position[axis] = limit - b.radius;
          b.velocity[axis] = -Math.abs(b.velocity[axis]) * b.bounce;
        }
      }
      this.#grid.insert(b);
      if (b.energy < 1e-4) {
        if (++b.asleep === 60) this.#tell({ kind: "sleep", id: b.id });
    } else b.asleep = 0;
    }
    const found: Contact[] = [];
    for (const [a, b] of this.#grid.pairs()) {
      this.tested++;
      const c = World.contact(a, b);
      if (c) found.push(c);
    }
    found.sort((p, q) => q.depth - p.depth || p.a.id - q.a.id || p.b.id - q.b.id);
    for (const c of found) this.#solve(c);
    this.time += dt;
    return stored + this.bodies.reduce((s, b) => s + b.energy, 0);
  }
}
