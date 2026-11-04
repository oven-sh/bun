// a recursion that is no tail call overflows the stack with ten small functions below it, is caught, and the program goes on
function d1(v: number): number { return v + 1; }
function d2(v: number): number { return d1(v) * 2; }
function d3(v: number): number { return d2(v) + 3; }
function d4(v: number): number { return d3(v) * 2; }
function d5(v: number): number { return d4(v) + 5; }
function d6(v: number): number { return d5(v) * 2; }
function d7(v: number): number { return d6(v) + 7; }
function d8(v: number): number { return d7(v) * 2; }
function d9(v: number): number { return d8(v) + 9; }
function d10(v: number): number { return d9(v) * 2; }
let turns = 0;
function endless(n: number): number {
  turns++;
  return d10(n) + endless(n + 1);
}
function deed() {
  turns = 0;
  try {
    return String(endless(0));
  } catch (e) {
    return (e as Error).name + " " + (turns > 100);
  }
}
console.log(deed());
for (let i = 0; i < 3; i++) console.log(deed());
console.log(String(d10(1)));
