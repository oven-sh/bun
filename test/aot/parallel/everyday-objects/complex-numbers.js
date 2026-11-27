// The same with fractions: complex numbers squared until they are far away
class Complex {
  constructor(re, im) {
    this.re = re;
    this.im = im;
  }
  square() {
    return new Complex(this.re * this.re - this.im * this.im, 2 * this.re * this.im);
  }
  add({ re, im }) {
    this.re += re;
    this.im += im;
    return this;
  }
}
function escape(re, im) {
  const c = new Complex(re, im);
  let z = new Complex(0.5, 0.5);
  let n = 0;
  while (n < 20 && z.re * z.re + z.im * z.im < 4) {
    z = z.square().add(c);
    n++;
  }
  return n + " " + z.re.toFixed(4) + " " + z.im.toFixed(4);
}
console.log(escape(0.25, 0.5));
console.log(escape(-0.75, 0.125));
console.log(escape(1.5, -1.5));
