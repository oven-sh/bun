globalThis.runs = (globalThis.runs ?? 0) + 1;
export const box = { f: () => "f" };
export const run = () => box.f();
export function plain() {
  return "p";
}
