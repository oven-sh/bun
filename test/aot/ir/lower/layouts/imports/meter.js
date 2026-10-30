export function Meter() {
  this.made = 1;
}
Meter.prototype.read = function () {
  return this.made;
};
