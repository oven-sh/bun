// A pattern steps an iterator: once a step finds the end, later steps answer undefined even if the array has grown since, and a step reads the length of that moment. Each pattern here has something between or inside its steps that changes the array, beside plain ones.
function plain(list: number[]): string {
  const [first, second, third] = list;
  return first + " " + second + " " + third;
}
function growsAfterTheEnd(list: number[]): string {
  const [first = (list.push(7, 8, 9), -1), second, third] = list;
  return first + " " + second + " " + third + " length " + list.length;
}
function shrinksBetweenSteps(list: number[]): string {
  const [first, second = (list.length = 0, -2), third] = list;
  return first + " " + second + " " + third + " length " + list.length;
}
function skips(list: number[]): string {
  const [, second, , fourth] = list;
  return second + " " + fourth;
}
function withRest(list: number[]): string {
  const [first, ...rest] = list;
  return first + " [" + rest.join() + "]";
}
function intoTargets(list: number[]): string {
  const target: { a?: number; b?: number } = {};
  [target.a, target.b] = list;
  return target.a + " " + target.b;
}
function swaps(list: number[]): string {
  [list[0], list[1]] = [list[1], list[0]];
  return list.join();
}
const count = process.argv.length > 100 ? 1 : 3;
const make = (length: number): number[] => { const list: number[] = []; for (let i = 0; i < length; ++i) list.push(i + 1); return list; };
for (let length = 0; length <= count + 1; ++length) {
  console.log(length, "|", plain(make(length)), "|", growsAfterTheEnd(make(length)), "|", shrinksBetweenSteps(make(length)), "|", skips(make(length)), "|", withRest(make(length)), "|", intoTargets(make(length)), "|", swaps(make(length)));
}
const holes = make(3);
delete holes[1];
console.log("a hole:", plain(holes), "|", shrinksBetweenSteps(holes));
const withGetter = make(3);
Object.defineProperty(withGetter, 0, { get() { withGetter.length = 1; return 100; }, configurable: true });
console.log("a getter that shortens the array:", plain(withGetter));
