function join(...values: any[]): any { let s: any = ""; for (let i = 0; i < values.length; i++) s += values[i]; return s; }
function add(...values: any[]): any { let s: any = 0; for (let i = 0; i < values.length; i++) s += values[i]; return s; }
function addTo(s: any, ...values: any[]): any { for (let i = 0; i < values.length; i++) s += values[i]; return s; }
const seen: string[] = [];
const talks = (name: string, value: number) => ({ valueOf() { seen.push(name); return value; } });
for (let i = 0; i < 3; i++) {
  console.log(join(i, "a", null, undefined, true, 1.5, [i, 2], { toString() { return "o" + i; } }));
  console.log(add(i, 1.5, -0), add(i, "x", 2), addTo(1n, BigInt(i), 2n), add(i, undefined), add(i, null, true), Object.is(add(-0), 0));
  console.log(add(talks("first", 1), talks("second", i), talks("third", 3)), seen.join());
}
try { add(1, 2n); } catch (error) { console.log((error as Error).constructor.name); }
try { add(1, Symbol("s")); } catch (error) { console.log((error as Error).constructor.name); }
