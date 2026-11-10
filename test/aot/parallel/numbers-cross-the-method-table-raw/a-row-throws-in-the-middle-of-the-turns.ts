// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: the form in which a number crosses a call is a matter of the calling convention: the checks read every unit against the plan
interface Gate { pass(load: number): number }
class Open implements Gate { pass(load: number): number { return load + 1; } }
class Narrow implements Gate { pass(load: number): number { if (load > 40) throw new RangeError("too wide: " + load); return load * 1.5; } }
class Slow implements Gate { pass(load: number): number { return load - 0.25; } }
class Toll implements Gate { pass(load: number): number { return load * 0.9; } }
class Shut implements Gate { pass(load: number): number { if (load % 11 === 0) throw load; return load; } }
const gates: Gate[] = [new Open(), new Narrow(), new Slow(), new Toll(), new Shut()];
let load = 1, caught = 0, last: unknown = "";
for (let i = 0; i < 400; i++) {
  try { load = gates[i % 5]!.pass(load); } catch (thrown) { caught++; last = thrown instanceof Error ? thrown.message : thrown; load = i % 13; } finally { load += 0.5; }
}
console.log(load, caught, String(last));
