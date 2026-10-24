// Fields that a constructor fills with closures are read, called, compared, replaced and deleted.
function Button(label) {
  this.label = label;
  this.clicks = 0;
  this.click = () => ++this.clicks;
  this.describe = function () { return this.label + " " + this.clicks; };
  this.reset = () => { this.clicks = 0; };
}
class Switch {
  constructor(label) {
    this.label = label;
    this.clicks = 0;
    this.click = () => ++this.clicks;
    this.describe = function () { return this.label + " " + this.clicks; };
    this.reset = () => { this.clicks = 0; };
  }
}
function use(button) {
  button.click();
  button.click();
  return button.describe() + " " + typeof button.reset + " " + (button.click === button.click) + " " + Object.keys(button).join();
}
for (const Maker of [Button, Switch]) {
  const made = [];
  for (let i = 0; i < 40; i++) made.push(new Maker("b" + i));
  console.log(use(made[0]), made[0].click === made[1].click);
  delete made[1].reset;
  made[2].click = function () { return (this.clicks += 10); };
  made[3].describe = null;
  made[4].click = made[5].click;
  Object.defineProperty(made[6], "describe", { get() { return () => "from a getter"; } });
  const kept = made[7].click;
  delete made[7].click;
  Maker.prototype.click = function () { return (this.clicks -= 1); };
  for (let i = 1; i < 9; i++) {
    try {
      console.log(i, use(made[i]));
    } catch (error) {
      console.log(i, error.constructor.name);
    }
  }
  console.log(kept(), made[7].clicks, made[5].clicks);
  delete Maker.prototype.click;
}
