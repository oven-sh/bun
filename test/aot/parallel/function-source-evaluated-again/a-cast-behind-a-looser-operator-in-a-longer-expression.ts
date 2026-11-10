// The parentheses go around what the cast holds and no more.
function mixed(x: number, a: number, b: number, c: number) {
  return [x || a + b as number * c, x - a << b as number + c, a < b as any + c, a ** b as number ** c, x + (a + b as number * c) as number % 7];
}
const again = (0, eval)("(" + String(mixed) + ")");
console.log(JSON.stringify(mixed(0, 1, 2, 3)), JSON.stringify(again(0, 1, 2, 3)));
console.log(JSON.stringify(mixed(5, 2, 3, 2)), JSON.stringify(again(5, 2, 3, 2)));
