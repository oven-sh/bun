export function lay() {
  Object.defineProperty(Object.prototype, "late", { set(value) { (this as any).name = 7; }, configurable: true });
}
export function takeAway() {
  delete (Object.prototype as any).late;
}
