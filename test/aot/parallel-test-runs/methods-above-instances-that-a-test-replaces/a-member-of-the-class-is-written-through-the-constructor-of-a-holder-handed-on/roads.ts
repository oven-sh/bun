export const aboveAll: any = Object.prototype;
export const named = (...parts: string[]): string => parts.join("");
export function put(target: any, name: string | symbol, value: unknown): unknown {
  const before = target[name];
  target[name] = value;
  return before;
}
