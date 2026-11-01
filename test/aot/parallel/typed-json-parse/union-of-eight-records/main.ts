// Parsed texts flow into a union of eight interfaces, beside a file that has nothing to do with them.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { unrelated } from "./unrelated.ts";
import type { Any } from "./shapes.ts";
const kept: unknown[] = [];
function keep(data: any): any {
  kept.push(data);
  return data;
}
function read(text: string): Any {
  return keep(JSON.parse(text));
}
function describe(x: Any): string {
  return x.tag + " " + (x.a + x.f);
}
const texts = [
  '{"tag":"arrow","a":0,"b":2,"c":3,"d":4,"e":5,"f":6,"g0":7}',
  '{"tag":"func","a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"g1":7}',
  '{"tag":"vardecl","a":2,"b":2,"c":3,"d":4,"e":5,"f":6,"g2":7}',
  '{"tag":"callexpr","a":3,"b":2,"c":3,"d":4,"e":5,"f":6,"g3":7}',
  '{"tag":"switchdata","a":4,"b":2,"c":3,"d":4,"e":5,"f":6,"g4":7}',
  '{"tag":"method","a":5,"b":2,"c":3,"d":4,"e":5,"f":6,"g5":7}',
  '{"tag":"getter","a":6,"b":2,"c":3,"d":4,"e":5,"f":6,"g6":7}',
  '{"tag":"reducedata","a":7,"b":2,"c":3,"d":4,"e":5,"f":6,"g7":7}',
];
texts.forEach((text, index) => {
  const value = read(text);
  console.log(describe(value), value === kept[index], unrelated);
});
