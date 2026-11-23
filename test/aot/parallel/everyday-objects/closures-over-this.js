// Arrow functions, bound functions and a kept self, called from elsewhere
class Button {
  constructor(label) {
    this.label = label;
    this.clicks = 0;
    this.arrow = n => (this.clicks += n);
    this.bound = this.method.bind(this, 10);
    const self = this;
    this.kept = function (n) {
      return (self.clicks += n * 100) + (this === self ? "!" : "?");
    };
  }
  method(a, b) {
    return (this.clicks += a + b);
  }
}
function press(label, n) {
  const { arrow, bound, kept } = new Button(label);
  const button = new Button(label);
  return [arrow(n), bound(n), kept(n), button.kept(n), button.clicks].join();
}
console.log(press("ok", 1));
console.log(press("no", 5));
console.log(press("", 0));
