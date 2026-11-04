function leaf(v: number): number {
  return v + 1;
}
function endless(n: number): number {
  return leaf(n) + endless(n + 1);
}
function tried(): string {
  try {
    return String(endless(0));
  } catch (e) {
    return (e as Error).name;
  }
}
console.log("second runs");
export const fromSecond = tried();
