const unseen = (x: any): any => [x][JSON.parse("0")];
function ways(value: any, kind: number): number {
  let said = 0;
  out: { switch (kind) { case 0: break out; case 1: if (value && kind) { said = 1; break out; } break out; default: said = 3; } said += 10; }
  if (value && kind < 3) return said + 100;
  return said;
}
function caught(value: any, fails: boolean): number { let said = 0; try { if (value && fails) throw value; said = 1; } catch (thrown) { said = 2; } if (value && !fails) return said + 10; return said; }
function mixed(value: any, a: boolean, b: boolean, c: boolean): number { let said = 0; out: { if (value) { if (a) { said = 1; break out; } } said += 10; if (b) said += 100; } if (value && c) return said + 1000; return said; }
const all: number[] = [];
for (const value of [undefined, {}, 0, "x"]) { for (let kind = 0; kind < 4; kind++) all.push(Reflect.apply(ways, undefined, [unseen(value), kind])); all.push(Reflect.apply(caught, undefined, [unseen(value), true]), Reflect.apply(caught, undefined, [unseen(value), false])); for (let bits = 0; bits < 8; bits++) all.push(Reflect.apply(mixed, undefined, [unseen(value), !!(bits & 1), !!(bits & 2), !!(bits & 4)])); }
console.log(all.join());
