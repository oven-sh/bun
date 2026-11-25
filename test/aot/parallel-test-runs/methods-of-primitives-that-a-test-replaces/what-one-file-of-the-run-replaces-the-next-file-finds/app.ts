export function words(line: string): string {
  return line.trim().split(" ").join("+") + ":" + line.indexOf("b") + ":" + line.charCodeAt(1);
}
export function fixed(value: number): string {
  return value.toFixed(1) + ":" + value.toString(2);
}
