class Crate { weight = 1; lift() { return this.weight; } }
class Barrel extends Crate { hoops = 2; staves = 5; roll() { return this.hoops + this.staves + this.weight; } }
class Plain extends Barrel { }
class Cask extends Plain { bung = 4; seal() { return this.bung + this.hoops; } }
class Keg extends Cask { tap = 3; pour() { return this.tap + this.bung + this.staves + this.hoops + this.weight; } }
const keg = new Keg();
console.log(keg.pour(), new Cask().seal(), keg.roll(), keg.lift());
