export function number(value: number): string {
  return value.toFixed(2) + "|" + value.toString(16) + "|" + value.toPrecision(3) + "|" + value.valueOf();
}
export function boolean(value: boolean): string {
  return value.toString() + "|" + value.valueOf();
}
export function symbol(value: symbol): string {
  return value.toString() + "|" + value.description;
}
export function bigInteger(value: bigint): string {
  return value.toString(2) + "|" + value.valueOf();
}
