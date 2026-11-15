export async function floorsBetweenWaits(values: number[]): Promise<string> {
  let said = "";
  for (let at = 0; at < values.length; at++) {
    said += Math.floor(values[at]!) + ",";
    await null;
  }
  return said;
}
export async function floorsBehindWaits(values: number[], wait: Promise<unknown>): Promise<number> {
  let sum = 0;
  for (let at = 0; at < values.length; at++) {
    await wait;
    sum += Math.floor(values[at]!);
  }
  return sum;
}
export function* floorsOneByOne(values: number[]): Generator<number> {
  for (let at = 0; at < values.length; at++) yield Math.floor(values[at]!);
}
export function floorsBy(values: number[], each: (value: number) => void): number {
  let sum = 0;
  for (let at = 0; at < values.length; at++) {
    sum += Math.floor(values[at]!);
    each(sum);
  }
  return sum;
}
