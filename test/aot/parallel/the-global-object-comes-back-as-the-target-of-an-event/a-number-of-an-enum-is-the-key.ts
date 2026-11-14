// A control: the key is a number, and no text of the program names a method that hands out the global object.
// STATISTIC: FunctionsLowered <= 1000
enum Place {
  First,
  Second,
}
const list = ["one", "two"];
console.log(list[Place.Second], Place[Place.First]);
