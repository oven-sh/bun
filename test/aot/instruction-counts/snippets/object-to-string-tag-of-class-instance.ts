// asks Object.prototype.toString for the tag of an instance of a class that extends another
class Vehicle {
  wheels = 4;
}
class Truck extends Vehicle {
  load = 1;
}
const operations = 100;
const fleet: object[] = [];
for (let i = 0; i < operations; i++) fleet.push(i & 1 ? new Truck() : new Vehicle());
const tagOf = Object.prototype.toString;
let total = 0;

kernel: {
  for (let i = 0; i < fleet.length; i++) {
    if (tagOf.call(fleet[i]).length === 15) total++;
  }
}

console.log(total);
