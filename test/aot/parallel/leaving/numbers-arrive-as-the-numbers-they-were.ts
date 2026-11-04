// minus zero, NaN, the ends of int32, doubles that are whole numbers and integers beyond 2 ** 53 are alive where the test fails
// whoever calls goes through a name that nobody knows at build time: the function is entered by value, at its own body, and is copied into no caller
const hiddenNames = JSON.parse('["f"]');
function through<T>(f: T): T { const box: any = { f }; return ((...list: any[]) => box[hiddenNames[0]](...list)) as any; }
class Kind { flags: number; id: number; constructor(flags: number) { this.flags = flags; this.id = flags + 1; } }
function edges(type: Kind, zero: number, one: number, huge: number) {
  const minusZero = -zero, nan = zero / zero, infinite = one / zero, whole = one * 3.0, least = (-2147483647 - one) | 0, most = (2147483646 + one) | 0;
  const over = 2147483647 + one, under = -2147483648 - one, half = one / 2, wide = huge * 2, exact = huge + one, tiny = one / huge;
  const a = type.flags;
  return [a, Object.is(minusZero, -0), Object.is(minusZero, 0), nan !== nan, infinite, whole, least, most, over, under, half, wide, exact, tiny, 1 / minusZero, typeof whole, (whole as any) === 3].join(" ");
}
const edgesByValue = through(edges);
const other = { flags: "f" };
console.log(edgesByValue(new Kind(1), 0, 1, 9007199254740992));
console.log(edgesByValue(other as any, 0, 1, 9007199254740992));
for (let i = 0; i < 300; i++) edgesByValue(i % 5 ? new Kind(i) : (other as any), 0, 1, 2 ** 40);
console.log(edgesByValue(other as any, 0, 1, 2 ** 40), edgesByValue(other as any, 0, -1, -(2 ** 60)));
