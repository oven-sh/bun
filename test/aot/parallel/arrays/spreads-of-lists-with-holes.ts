// Spreads of lists with holes: integers, fractions, objects and strings, into a new list, behind other elements, twice, and of lists that grow or shrink first.
const out: string[] = [];
const show = (label: string, list: unknown[]) => out.push(`${label}: ${list.length} ${JSON.stringify(list)} ${list.map((_, i) => i in list).join()} ${1 in list}`);
const whole: number[] = [1, 2, 3, , 5, 6, 7, 8] as number[];
const fractions: number[] = [0.5, , 2.5, NaN, -0] as number[];
const objects: ({ x: number } | undefined)[] = [{ x: 1 }, , { x: 3 }];
const texts: (string | undefined)[] = [, "a", , "b"];
const onlyHoles: unknown[] = new Array(3);
function copy<T>(list: T[]): T[] { return [...list]; }
for (const [label, list] of [["whole", whole], ["fractions", fractions], ["objects", objects], ["texts", texts], ["holes", onlyHoles]] as [string, unknown[]][]) {
  const made = copy(list);
  show(label, made);
  made.push(9); made[0] = "first";
  show(label + " written", made);
  show(label + " source", list);
  show(label + " behind", [0, ...list]);
  show(label + " twice", [...list, ...list]);
}
const long: number[] = []; long[40] = 1; long[3] = 0.5; show("long", copy(long));
whole.length = 5; show("shorter", copy(whole)); whole[9] = 10; show("longer", copy(whole));
let sum = 0;
for (let i = 0; i < 100000; i++) { const b = [...fractions]; sum += (b[i & 3] ?? 1) === (b[i & 3] ?? 1) ? b.length : 0; }
out.push(String(sum));
console.log(out.join("\n"));
