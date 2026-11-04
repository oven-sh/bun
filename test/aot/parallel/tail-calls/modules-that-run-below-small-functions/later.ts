function leaf(v: number): number {
  return v * 3;
}
console.log("later runs");
export const fromLater = String(leaf(leaf(2)));
