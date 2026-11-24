// Roman numbers: two lists walked together, pieces pushed in a while loop
function roman(number) {
  const values = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const texts = ["M", "CM", "D", "CD", "C", "XC", "L", "XL", "X", "IX", "V", "IV", "I"];
  const pieces = [];
  let steps = 0;
  for (let i = 0; i < 13; i++) {
    while (number >= values[i]) {
      pieces.push(texts[i]);
      number -= values[i];
      steps++;
    }
    steps += i;
  }
  return pieces.join("") + " " + steps;
}
console.log(roman(1994));
console.log(roman(3888));
console.log(roman(0), roman(4.5));
