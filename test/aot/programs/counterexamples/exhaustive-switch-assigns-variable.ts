// A variable without an initializer is assigned in every case of a switch that is exhaustive over a union of literals.
declare const console: { log(...values: unknown[]): void };
type Marker = '+' | '-' | ' '
function f(marker: Marker, a: number, b: number) {
  let n: number
  switch (marker) {
    case '+':
      n = a
      break
    case '-':
      n = b
      break
    case ' ':
      n = a + b
      break
  }
  return { n, marker }
}
console.log(f('+', 1, 2).n, f('-', 1, 2).n, f(' ', 1, 2).n)
