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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=Process
// CHECK-NEXT: v1 = PropGet v0 key="argv"
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(ProcessArgv) flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer integer=2
// CHECK-NEXT: v4 = ElemGet v2, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v6 = Builtin builtin=Process
// CHECK-NEXT: v7 = PropGet v6 key="argv"
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(ProcessArgv) flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="length"
// CHECK-NEXT: v10 = Convert v9 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v11 = Integer integer=99
// CHECK-NEXT: v12 = Greater v10, v11
// CHECK-NEXT: Branch v12 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v13 = Builtin builtin=GlobalThis
// CHECK-NEXT: v14 = PropGet v13 key="console" [isFreeName]
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v15 key="log"
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v18 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v19 = CheckInitialized v18 name="summary"
// CHECK-NEXT: v20 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v21 = CheckInitialized v20 name="run"
// CHECK-NEXT: v22 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v23 = CheckInitialized v22 name="world"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|Array<undefined|null|[[L_4]]|[[L_5]]> flags=[IsExpected]}
// CHECK-NEXT: v25 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v26 = CheckInitialized v25 name="options"
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|[[L_7]] flags=[IsExpected]}
// CHECK-NEXT: v28 = Call v21, -, v24, v27 calleeName="run"
// CHECK-NEXT: v29 = Call v19, -, v28 calleeName="summary"
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v31 = Call v17, v15, v30 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v32 = Undefined
// CHECK-NEXT: Return v32
// CHECK-NEXT: }
