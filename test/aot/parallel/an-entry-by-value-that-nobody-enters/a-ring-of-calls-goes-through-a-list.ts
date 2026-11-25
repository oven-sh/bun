// Two functions that call each other, one of them through a list.
const ring: Array<(n: number) => number> = [];
function down(n: number): number {
  return n <= 0 ? 0 : across(n - 1) + 1;
}
function across(n: number): number {
  return n <= 0 ? 0 : ring[n % 1](n - 1) + 1;
}
ring.push(down);
console.log(down(6), across(5));
