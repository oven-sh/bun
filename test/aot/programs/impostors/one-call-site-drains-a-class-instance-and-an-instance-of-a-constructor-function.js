class Tank {
  constructor(liters) {
    this.liters = liters;
  }
  drain() {}
}
function OldTank(liters) {
  this.liters = liters;
}
OldTank.prototype.drain = function () {
  this.liters = 0;
};
const tanks = [new Tank(1), new OldTank(2)];
for (const tank of tanks) {
  tank.drain();
  console.log(tank.liters);
}
