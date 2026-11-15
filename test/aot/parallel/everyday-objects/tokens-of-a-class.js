// A reader class whose methods move one position field through a text
class Reader {
  constructor(text) {
    this.text = text;
    this.at = 0;
  }
  peek() {
    return this.text[this.at];
  }
  number() {
    let n = 0;
    while (this.peek() >= "0" && this.peek() <= "9") n = n * 10 + +this.text[this.at++];
    return n;
  }
  sum() {
    let total = this.product();
    while (this.peek() === "+" || this.peek() === "-") total += this.text[this.at++] === "+" ? this.product() : -this.product();
    return total;
  }
  product() {
    let total = this.atom();
    while (this.peek() === "*") (this.at++, (total *= this.atom()));
    return total;
  }
  atom() {
    if (this.peek() !== "(") return this.number();
    this.at++;
    const total = this.sum();
    this.at++;
    return total;
  }
}
for (const text of ["1+2*3", "(4-1)*(2+3)-10"]) console.log(text, new Reader(text).sum());
console.log(new Reader("2*(3+(4*5))").sum());
