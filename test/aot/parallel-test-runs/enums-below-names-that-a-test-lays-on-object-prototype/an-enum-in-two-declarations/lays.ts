export const taken: unknown[] = [];
Object.defineProperty(Object.prototype, "Late", { get() { return "above"; }, set(value) { taken.push(value); }, configurable: true });
export function takeAway() { delete (Object.prototype as any).Late; }
