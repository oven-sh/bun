// A field that starts at zero is added to and subtracted from, and every store that the program shows is such a sum. What is no integer, or is too large a one, is copied into it out of parsed text. The sums go on from there as plain arithmetic has them.
class Sum {
  constructor() {
    this.n = 0;
  }
  up() {
    this.n++;
  }
  down() {
    this.n--;
  }
  double() {
    this.n += this.n;
  }
  addThree() {
    this.n += 3;
  }
  takeThree() {
    this.n -= 3;
  }
  addMost() {
    this.n += 2147483647;
  }
  takeMost() {
    this.n -= 2147483647;
  }
  addPositive(x) {
    this.n += x & 0x7fffffff;
  }
  takePositive(x) {
    this.n -= x & 0x7fffffff;
  }
  addInteger(x) {
    this.n += x | 0;
  }
  addThreeAndRead() {
    this.n += 3;
    return this.n;
  }
  readAndCount() {
    return this.n++;
  }
}
function at(start) {
  const sum = new Sum();
  for (const bit of Math.abs(start).toString(2)) {
    sum.double();
    if (bit === "1") {
      if (start < 0) sum.down();
      else sum.up();
    }
  }
  return sum;
}
const out = [];
for (const odd of [
  "0.5",
  "-0",
  "1e300",
  "4503599627370495",
  "4503599627370496",
  "-4503599627370496",
  "-4503599627370497",
  '"1"',
  "null",
  "true",
  "[7]",
  "{}",
]) {
  for (const step of ["up", "down", "addThree", "takeMost", "double", "addThreeAndRead", "readAndCount"]) {
    const sum = at(5000000000);
    Object.assign(sum, JSON.parse('{"n":' + odd + "}"));
    const answer = sum[step]();
    out.push(
      odd + " " + step + " " + String(answer) + " " + String(sum.n) + " " + typeof sum.n + " " + Object.is(sum.n, -0),
    );
    Object.assign(sum, JSON.parse('{"n":4294967295}'));
    sum[step]();
    out.push(odd + " " + step + " then " + sum.n + " " + JSON.stringify(sum) + " " + Object.keys(sum));
  }
}
console.log(out.join("\n"));
