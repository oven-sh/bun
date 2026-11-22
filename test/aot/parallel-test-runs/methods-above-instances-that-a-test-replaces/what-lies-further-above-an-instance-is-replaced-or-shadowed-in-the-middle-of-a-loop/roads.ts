export const aboveLists: any = Object.getPrototypeOf([]);
export const aboveSets: any = Object.getPrototypeOf(new Set());
export const aboveMaps: any = Object.getPrototypeOf(new Map());
export const aboveTexts: any = Object.getPrototypeOf(Object("x"));
export const aboveAll: any = Object.getPrototypeOf({});
export const named = (...parts: string[]): string => parts.join("");
export const symbolNamed = (...parts: string[]): symbol => (Symbol as any)[parts.join("")];
export function put(target: any, name: string | symbol, value: unknown): unknown {
  const before = target[name];
  target[name] = value;
  return before;
}
export function drop(target: any, name: string | symbol): void {
  delete target[name];
}
export const aboveBytes: any = Object.getPrototypeOf(new Uint8Array(0));
export const aboveDoubles: any = Object.getPrototypeOf(new Float64Array(0));
export const aboveViews: any = Object.getPrototypeOf(aboveBytes);
export function define(target: any, name: string | symbol, descriptor: PropertyDescriptor): void {
  Object.defineProperty(target, name, { configurable: true, ...descriptor });
}
