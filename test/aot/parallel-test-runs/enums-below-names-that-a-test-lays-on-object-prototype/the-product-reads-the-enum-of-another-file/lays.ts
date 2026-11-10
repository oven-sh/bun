export const taken: unknown[] = [];
Object.defineProperty(Object.prototype, "Ready", { get() { return "above"; }, set(value) { taken.push(value); }, configurable: true });
export function takeAway() { delete (Object.prototype as any).Ready; }
