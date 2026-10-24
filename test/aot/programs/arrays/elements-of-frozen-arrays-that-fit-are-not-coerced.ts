// An element read from an array whose elements are not in plain storage (a template object: it is frozen) is returned as it is when it fits the declared type. The program counts how often the run time is asked whether a value fits.
declare const aotOperationCount: undefined | ((name: string) => number);
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
interface Point {
  x: number;
  y: number;
}
function lengths(strings: readonly string[]): number {
  let total = 0;
  for (let i = 0; i < strings.length; i++) total += strings[i]!.length;
  return total;
}
function tag(strings: TemplateStringsArray, ..._values: unknown[]): number {
  return lengths(strings);
}
let total = 0;
for (let turn = 0; turn < 2000; turn++) total += tag`select ${turn} from ${turn} where`;
const frozen: readonly (string | number | null)[] = Object.freeze(["a", 1, null, 2.5]);
const seen: unknown[] = [];
for (let i = 0; i < 5; i++) seen.push(frozen[i]);
const points = Object.freeze(JSON.parse('[{"x":1,"y":2}]')) as readonly Point[];
const sum = points[0]!.x + points[0]!.y;
const asked = counted ? counted("operationAOTEnforceType") : null;
console.log(total, JSON.stringify(seen), sum, asked === null || asked < 100);
