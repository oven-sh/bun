// filter-map, loud callbacks: both throw
const hidden = JSON.parse('{"set":"set","define":"defineProperty","remove":"deleteProperty","below":"setPrototypeOf","freeze":"freeze"}');
const reflect: any = Reflect;
const object: any = Object;
const log: string[] = [];
let source: number[] = [];
let isArmed = false;
let firsts = 0;
let seconds = 0;
let total = 0;
class Below extends Array<number> {
  filter(...operands: any[]): any { note("below filter"); return (super.filter as any)(...operands); }
  map(...operands: any[]): any { note("below map"); return (super.map as any)(...operands); }
  slice(...operands: any[]): any { note("below slice"); return (super.slice as any)(...operands); }
}
function note(text: string) { log.push(text); }
function show(value: any): string {
  if (!Array.isArray(value)) return typeof value + " " + String(value);
  let text = "[";
  for (let index = 0; index < value.length && index < 50; index++) text += (index ? "," : "") + (index in value ? (value[index] === value ? "itself" : String(value[index])) : "hole");
  return text + "]";
}
function inFirst() { if (isArmed && ++firsts === 3) { throw new RangeError("first"); } }
function inSecond() { if (isArmed && ++seconds === 1) { throw new TypeError("second"); } }
function subject(list: number[]) { return list.filter(x => { note("f" + x); inFirst(); return x > 1; }).map(x => { note("g" + x); inSecond(); return x * 2; }); }
function deed(list: number[]): number[] { isArmed = true;  return list; }
function run(list: number[]) {
  log.length = 0;
  firsts = seconds = total = 0;
  source = list;
  let answer: string;
  try { answer = show(subject(list)); } catch (error: any) { answer = error.name + ": " + error.message.replace(/ \(In '[^]*$/, ""); }
  isArmed = false;
  let left: string;
  try { left = show(list); } catch (error: any) { left = error.name; }
  console.log(answer + " | " + log.join(" ") + " | " + total + " | " + left);
}
run([1, 2, 3, 4]);
for (let turn = 0; turn < 3; turn++) run([turn, 2, 5, 4]);
run(deed([1, 2, 3, 4]));
run([1, 2, 3, 4]);
