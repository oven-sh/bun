import vm from "node:vm";
export function plug(what: unknown): void {
  Bun.plugin(what as never);
}
export function elsewhere(text: string): unknown {
  return vm.runInNewContext(text);
}
export function here(text: string): unknown {
  return vm.runInThisContext(text);
}
export function made(text: string): unknown {
  return new Function(text)();
}
export function floors(values: number[]): string {
  let said = "";
  for (let at = 0; at < values.length; at++) said += Math.floor(values[at]!) + ",";
  return said;
}
export function sums(count: number): number {
  let sum = 0;
  for (let at = 0; at < count; at++) sum += Math.floor(at / 3) + Math.max(at, 2);
  return sum;
}
export function lists(values: unknown[]): number {
  let found = 0;
  for (let at = 0; at < values.length; at++) if (Array.isArray(values[at])) found++;
  return found;
}
export function floorsWith(values: number[], atTurn: number, text: string): string {
  let said = "";
  for (let at = 0; at < values.length; at++) {
    if (at === atTurn) here(text);
    said += Math.floor(values[at]!) + ",";
  }
  return said;
}
