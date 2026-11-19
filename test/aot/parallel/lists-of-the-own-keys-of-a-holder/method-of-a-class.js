const key = Object.getOwnPropertySymbols(Buffer.prototype).find(symbol =>
  String(symbol.description).endsWith("custom"),
);
class Parcel {
  [key](depth, options, inspect) {
    return "method of a class: " + inspect({ j: 10 });
  }
}
console.log(new Parcel());
