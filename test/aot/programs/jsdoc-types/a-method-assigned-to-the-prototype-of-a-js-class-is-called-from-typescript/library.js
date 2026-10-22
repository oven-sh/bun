export class Grown {
  constructor() {
    this.x = 1;
  }
}
Grown.prototype.extra = function () {
  return this.x + 1;
};
