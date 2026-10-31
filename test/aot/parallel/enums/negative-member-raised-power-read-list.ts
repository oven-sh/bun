// Members of an enum that hold negative numbers are raised to powers that are read out of a list. Plain Bun prints another output.
enum Numbers {
  Whole = -5,
  Half = -0.5,
  Computed = Whole - 1,
}
const powers = [2, 3];
console.log(Numbers.Whole ** powers[0], Numbers.Whole ** powers[1]);
console.log(Numbers.Half ** powers[0], Numbers.Half ** powers[1]);
console.log(Numbers.Computed ** powers[0], Numbers["Whole"] ** powers[1]);
for (const power of powers) console.log(power, Numbers.Whole ** power);
/* Output:
25 -125
0.25 -0.125
36 -125
2 25
3 -125
*/
