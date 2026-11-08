globalThis.probe();
var warm = typeof Bun === "object";
export function state() {
  return warm ? "late" : "early";
}
