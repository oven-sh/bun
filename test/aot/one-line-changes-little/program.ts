export class Vec {
  x: number;
  y: number;
  constructor(x: number, y: number) { this.x = x; this.y = y; }
  add(o: Vec): Vec { return new Vec(this.x + o.x, this.y + o.y); }
  scale(k: number): Vec { return new Vec(this.x * k, this.y * k); }
  len(): number { return Math.sqrt(this.x * this.x + this.y * this.y); }
}
export class Body {
  name: string;
  pos: Vec;
  vel: Vec;
  tags: string[] = [];
  hits = 0;
  constructor(name: string, pos: Vec, vel: Vec) { this.name = name; this.pos = pos; this.vel = vel; }
  step(dt: number): this { this.pos = this.pos.add(this.vel.scale(dt)); this.hits++; return this; }
  describe(): string { return this.name + ":" + this.pos.len().toFixed(2); }
  weight(): number { return 1; }
}
export class Heavy extends Body {
  mass: number;
  constructor(name: string, pos: Vec, vel: Vec, mass: number) { super(name, pos, vel); this.mass = mass; }
  override describe(): string { return super.describe() + "@" + this.mass; }
  override weight(): number { return this.mass; }
}
export class Ghost extends Body {
  seen = false;
  override weight(): number { return 0; }
}
export interface Options { dt: number; rounds: number; label: string; verbose: boolean }
export const options: Options = { dt: 0.5, rounds: 20, label: "world", verbose: false };
export type Handler = (body: Body) => void;
export const handlers = new Map<string, Handler[]>();
export function on(name: string, fn: Handler): void { let list = handlers.get(name); if (!list) handlers.set(name, (list = [])); list.push(fn); }
export function emit(name: string, body: Body): void { const list = handlers.get(name); if (list) for (let i = 0; i < list.length; i++) list[i]!(body); }
export function makeWorld(n: number): Body[] {
  const world: Body[] = [];
  for (let i = 0; i < n; i++) {
    const p = new Vec(i, i * 2), v = new Vec(1, -1);
    world.push(i % 3 === 0 ? new Heavy("h" + i, p, v, i + 1) : i % 3 === 1 ? new Ghost("g" + i, p, v) : new Body("b" + i, p, v));
  }
  return world;
}
export const stats = { steps: 0, weight: 0, longest: "", byKind: { heavy: 0, ghost: 0, plain: 0 } };
export function count(body: Body): void {
  stats.steps++; stats.weight += body.weight();
  if (body instanceof Heavy) stats.byKind.heavy++; else if (body instanceof Ghost) stats.byKind.ghost++; else stats.byKind.plain++;
  const text = body.describe(); if (text.length > stats.longest.length) stats.longest = text;
}
export function run(world: Body[], opts: Options): Body[] {
  for (let r = 0; r < opts.rounds; r++) for (let i = 0; i < world.length; i++) { const b = world[i]!.step(opts.dt); emit("step", b); if (b.hits === 3) b.tags.push(opts.label); }
  return world;
}
export function summary(world: Body[]): string {
  let out = "";
  for (const b of world) out += b.describe() + (b.tags.length ? "#" + b.tags[0] : "") + ";";
  return out + stats.steps + "/" + stats.weight + "/" + stats.longest + "/" + stats.byKind.heavy + stats.byKind.ghost + stats.byKind.plain;
}
export const world: Body[] = makeWorld(9);
on("step", count);
on("step", b => { if (b.pos.x > 1e9) b.vel = new Vec(0, 0); });
