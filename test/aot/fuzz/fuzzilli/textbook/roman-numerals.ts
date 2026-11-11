const values: [number, string][] = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];
function roman(value: number): string {
  let out = "";
  for (const [worth, letters] of values) {
    while (value >= worth) {
      out += letters;
      value -= worth;
    }
  }
  return out;
}
console.log(roman(Number("1994")), roman(Number("2024")), roman(4));
