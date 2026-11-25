export const aboveTexts: any = Object.getPrototypeOf(Object("x"));
export const aboveNumbers: any = Object.getPrototypeOf(Object(1));
export const aboveBooleans: any = Object.getPrototypeOf(Object(true));
export const aboveSymbols: any = Object.getPrototypeOf(Object(Symbol.iterator));
export const aboveBigIntegers: any = Object.getPrototypeOf(Object(1n));
export const aboveAll: any = Object.getPrototypeOf(aboveTexts);
export const named = (...parts: string[]): string => parts.join("");
export function put(target: any, name: string, value: unknown): unknown {
  const before = target[name];
  target[name] = value;
  return before;
}
