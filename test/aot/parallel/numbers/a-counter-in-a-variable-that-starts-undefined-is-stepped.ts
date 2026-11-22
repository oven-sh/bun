// a counter in a variable of a module and of a scope that holds undefined until it is set: stepped before it is set, past both ends of int32, as a fraction, from null, to zero from either side
var made: number;
var depth: number;
var sum: number;
function bump() { made++; }
function drop() { depth--; }
function add(by: number) { sum = sum + by; }
function take(by: number) { sum = sum - by; }
function show() { return String(made) + " " + String(depth) + " " + String(sum); }
bump(); drop(); add(1); console.log(show());
made = 0; depth = 0; sum = 0;
for (let turn = 0; turn < 300; turn++) { bump(); drop(); add(turn); take(1); }
console.log(show());
made = 2147483646; depth = -2147483647; sum = 2147483647;
bump(); bump(); bump(); drop(); drop(); drop(); add(2147483647); console.log(show());
take(2147483647); take(2147483647); take(2147483647); take(2147483647); console.log(show());
made = 0.5; depth = -0.5; sum = 0.25; bump(); drop(); add(1); take(0.5); console.log(show());
made = -1; bump(); depth = 1; drop(); sum = -0; add(0); console.log(1 / made, 1 / depth, 1 / sum);
sum = -0; take(0); console.log(1 / sum);
made = NaN; depth = Infinity; sum = -Infinity; bump(); drop(); add(1); console.log(show());
function scope() {
  let count: number | undefined;
  let other: number | null = null; // @ts-expect-error
  return { up() { count!++; return count; }, set(value: number) { count = value; }, down() { (other as number)--; return other; } };
}
const held = scope();
console.log(held.up(), held.down(), held.down());
held.set(2147483647); console.log(held.up(), held.up());
held.set(-2147483648); console.log(held.up());
