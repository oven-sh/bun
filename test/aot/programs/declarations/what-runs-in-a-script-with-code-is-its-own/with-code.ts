const counted = 1;
function helper(): number;
function helper(n: number): number;
function helper(n?: number): number {
  return n ?? counted;
}
interface Both {
  a: number;
}
const Both = { made: helper() };
console.log(Both.made);
