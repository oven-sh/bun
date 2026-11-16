export function codes(text: string): number {
  let sum = 0;
  for (let at = 0; at < text.length; at++) sum += text.charCodeAt(at);
  return sum;
}
export function cut(text: string): string {
  return text.slice(1);
}
export function total(values: number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum;
}
export function totalOfSet(values: Set<number>): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum;
}
export function found(values: Map<string, number>, key: string): unknown {
  return values.get(key);
}
export function fixed(value: number): string {
  return value.toFixed(1);
}
export function owns(values: number[], name: string): unknown {
  return values.hasOwnProperty(name);
}
export function codesWithHook(text: string, hook: (at: number) => void): string {
  const seen: number[] = [];
  for (let at = 0; at < text.length; at++) {
    hook(at);
    seen.push(text.charCodeAt(at));
  }
  return seen.join();
}
