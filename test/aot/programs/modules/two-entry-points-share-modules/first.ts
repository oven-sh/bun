export const lines: string[] = [];
export function log(...parts: unknown[]): void {
  lines.push(parts.join(" "));
}
export const name = "first";
log("first is evaluated");
