export function total(values: number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum;
}
export function byIndex(values: number[]): number {
  let sum = 0;
  for (let at = 0; at < values.length; at++) sum += values[at];
  return sum;
}
export function pastTheEnd(values: number[]): string {
  let said = "";
  for (let at = 0; at < values.length + 2; at++) said += values[at] + ",";
  return said;
}
export function joined(values: string[]): string {
  let said = "";
  for (const value of values) said += value;
  return said;
}
export function doubled(values: number[]): string {
  for (let at = 0; at < values.length; at++) values[at] = values[at] * 2;
  return values.join();
}
export function pairs(first: number[], second: number[]): number {
  let sum = 0;
  for (let at = 0; at < first.length; at++) sum += first[at] * second[at];
  return sum;
}
export function withHook(values: number[], hook: (at: number) => void): string {
  let said = "";
  for (let at = 0; at < values.length; at++) {
    hook(at);
    said += values[at] + ",";
  }
  return said;
}
export function steppedWithHook(values: number[], hook: (value: number) => void): string {
  let said = "";
  for (const value of values) {
    hook(value);
    said += value + ",";
  }
  return said;
}
export function found(values: number[], wanted: number): number {
  let places = 0;
  for (let at = 0; at < values.length; at++) if (values.includes(wanted + at)) places += at + 1;
  return places;
}
