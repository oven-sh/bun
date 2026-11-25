export function marks(): string {
  return "abc".toUpperCase() + "|" + "x".repeat(3) + "|" + "a,b".indexOf(",") + "|" + (5).toFixed(1) + "|" + true.toString() + "|" + (7n).toString();
}
export function sum(turns: number): number {
  let all = 0;
  for (let at = 0; at < turns; at++) all += "abcdef".charCodeAt(at);
  return all;
}
