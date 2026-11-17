// Functions with overloads, type guards and unions of numbers and texts
type Input = number | string | (number | string)[];
const isList = (input: Input): input is (number | string)[] => Array.isArray(input);
function measure(input: number): number;
function measure(input: Input): number;
function measure(input: Input): number {
  if (isList(input)) return input.reduce<number>((total, one) => total + measure(one), 0);
  return typeof input === "string" ? input.length : input * 10;
}
function all(...inputs: Input[]): string {
  return inputs.map(measure).join() + " " + measure(inputs.length);
}
console.log(all(1, 2, 3));
console.log(all("a", "bcd"));
console.log(all([1, "xx"], []));
