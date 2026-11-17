export const named = (...parts: string[]): string => parts.join("");
export function put(target: any, name: string, value: unknown): unknown {
  const before = target[name];
  target[name] = value;
  return before;
}
export const everything: any = globalThis;
export function tell(label: string, what: () => unknown): void {
  try {
    console.log(label, String(what()));
  } catch (error) {
    console.log(label, "throws", (error as Error).name);
  }
}
