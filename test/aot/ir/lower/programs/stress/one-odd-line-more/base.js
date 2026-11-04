// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: base.js
// One odd line that never runs stands beside a program that does not change: base. It prints what plain Bun prints.
import { Vec, Body, Heavy, Ghost, options, handlers, on, emit, makeWorld, stats, count, run, summary, world } from "./own.js";
const K = process.argv[2];
if (process.argv.length > 99) {
  
}
console.log(summary(run(world, options)));

// FILE: own.js
// The program that the files beside it import: it stays the same, and each of them adds one odd line.
export class Vec {
  constructor(x, y) { this.x = x; this.y = y; }
  add(o) { return new Vec(this.x + o.x, this.y + o.y); }
  scale(k) { return new Vec(this.x * k, this.y * k); }
  len() { return Math.sqrt(this.x * this.x + this.y * this.y); }
}
export class Body {
  constructor(name, pos, vel) { this.name = name; this.pos = pos; this.vel = vel; this.tags = []; this.hits = 0; }
  step(dt) { this.pos = this.pos.add(this.vel.scale(dt)); this.hits++; return this; }
  describe() { return this.name + ":" + this.pos.len().toFixed(2); }
  weight() { return 1; }
}
export class Heavy extends Body {
  constructor(name, pos, vel, mass) { super(name, pos, vel); this.mass = mass; }
  describe() { return super.describe() + "@" + this.mass; }
  weight() { return this.mass; }
}
export class Ghost extends Body {
  constructor(name, pos, vel) { super(name, pos, vel); this.seen = false; }
  weight() { return 0; }
}
export const options = { dt: 0.5, rounds: 20, label: "world", verbose: false };
export const handlers = new Map();
export function on(name, fn) { let list = handlers.get(name); if (!list) handlers.set(name, (list = [])); list.push(fn); }
export function emit(name, body) { const list = handlers.get(name); if (list) for (let i = 0; i < list.length; i++) list[i](body); }
export function makeWorld(n) {
  const world = [];
  for (let i = 0; i < n; i++) {
    const p = new Vec(i, i * 2), v = new Vec(1, -1);
    world.push(i % 3 === 0 ? new Heavy("h" + i, p, v, i + 1) : i % 3 === 1 ? new Ghost("g" + i, p, v) : new Body("b" + i, p, v));
  }
  return world;
}
export const stats = { steps: 0, weight: 0, longest: "", byKind: { heavy: 0, ghost: 0, plain: 0 } };
export function count(body) {
  stats.steps++; stats.weight += body.weight();
  if (body instanceof Heavy) stats.byKind.heavy++; else if (body instanceof Ghost) stats.byKind.ghost++; else stats.byKind.plain++;
  const text = body.describe(); if (text.length > stats.longest.length) stats.longest = text;
}
export function run(world, opts) {
  for (let r = 0; r < opts.rounds; r++) for (let i = 0; i < world.length; i++) { const b = world[i].step(opts.dt); emit("step", b); if (b.hits === 3) b.tags.push(opts.label); }
  return world;
}
export function summary(world) {
  let out = "";
  for (const b of world) out += b.describe() + (b.tags.length ? "#" + b.tags[0] : "") + ";";
  return out + stats.steps + "/" + stats.weight + "/" + stats.longest + "/" + stats.byKind.heavy + stats.byKind.ghost + stats.byKind.plain;
}
export const world = makeWorld(9);
on("step", count);
on("step", b => { if (b.pos.x > 1e9) b.vel = new Vec(0, 0); });

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=Process
// CHECK-NEXT: v1 = PropGet v0 key="argv"
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(ProcessArgv) flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer integer=2
// CHECK-NEXT: v4 = ElemGet v2, v3
// CHECK-NEXT: v5 = Builtin builtin=Process
// CHECK-NEXT: v6 = PropGet v5 key="argv"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(ProcessArgv) flags=[IsExpected]}
// CHECK-NEXT: v8 = PropGet v7 key="length"
// CHECK-NEXT: v9 = Integer integer=99
// CHECK-NEXT: v10 = Greater v8, v9
// CHECK-NEXT: Branch v10 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: v11 = Builtin builtin=GlobalThis
// CHECK-NEXT: v12 = PropGet v11 key="console" [isFreeName]
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="log"
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v16 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v17 = CheckInitialized v16 name="summary"
// CHECK-NEXT: v18 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v19 = CheckInitialized v18 name="run"
// CHECK-NEXT: v20 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v21 = CheckInitialized v20 name="world"
// CHECK-NEXT: v22 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v23 = CheckInitialized v22 name="options"
// CHECK-NEXT: v24 = Call v19, -, v21, v23 calleeName="run"
// CHECK-NEXT: v25 = Call v17, -, v24 calleeName="summary"
// CHECK-NEXT: v26 = Call v15, v13, v25 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v27 = Undefined
// CHECK-NEXT: Return v27
// CHECK-NEXT: }
