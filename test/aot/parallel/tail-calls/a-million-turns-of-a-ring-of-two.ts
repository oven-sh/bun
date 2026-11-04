// two functions call each other in tail position a million times
function even(n: number): string {
  return n === 0 ? "even" : odd(n - 1);
}
function odd(n: number): string {
  return n === 0 ? "odd" : even(n - 1);
}
function deed(n: number) {
  return even(n);
}
console.log(deed(3));
for (let i = 0; i < 5; i++) console.log(deed(1000 + i));
console.log(deed(1000000));
console.log(deed(1000001));
