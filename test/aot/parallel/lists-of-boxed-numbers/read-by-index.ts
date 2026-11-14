// The last line of a text that ends in a newline is no number: the list that it is read into keeps its numbers boxed.
function read(text: string): number[] {
  return text.split("\n").map(line => parseInt(line, 10));
}
function sum(list: number[]): number {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i]!;
  return total;
}
function falls(list: number[]): number {
  let count = 0;
  for (let i = 1; i < list.length; i++) if (list[i]! < list[i - 1]!) count++;
  return count;
}
function placesOf(list: number[], sought: number): string {
  let places = "";
  for (let i = 0; i < list.length; i++) if (list[i] === sought) places += i + ",";
  return places;
}
function thirds(list: number[]): number {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += Math.floor(list[i]! / 3) || 0;
  return total;
}
function intoView(list: number[]): string {
  const view = new Float64Array(8);
  for (let i = 0; i < list.length; i++) view[i & 7] = list[i]!;
  return view.join(",");
}
function product(left: number[], right: number[]): number {
  let total = 0;
  for (let i = 0; i < left.length; i++) total += (left[i]! * right[i]!) % 97 || 0;
  return total;
}
const whole = read("5\n3\n9\n1\n12\n7");
const endsInNewline = read("5\n3\n9\n1\n12\n7\n");
const changing = read("5\n3\n9\n1\n12\n7");
const odd: any[] = [4, "6", undefined, null, true, 2.5, -0, 5n];
const lists: number[][] = [whole, endsInNewline, [0.5, 1.25, -3, 1e300], [1, NaN, 3], changing, []];
for (let turn = 0; turn < 8; turn++) {
  if (turn === 3) changing[2] = NaN;
  if (turn === 5) changing.push(0.5);
  if (turn === 6) (changing as any)[0] = "8";
  if (turn === 7) delete changing[4];
  const told: unknown[] = [];
  for (const list of lists) told.push(sum(list), falls(list), placesOf(list, 9), thirds(list), intoView(list), product(list, whole));
  console.log(told.map(String).join(" "));
}
try {
  console.log(String(sum(odd)), falls(odd.slice(0, 7)));
} catch (error) {
  console.log((error as Error).constructor.name);
}
