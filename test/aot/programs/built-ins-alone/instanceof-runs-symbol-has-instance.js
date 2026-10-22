class Even {
  static [Symbol.hasInstance](value) {
    console.log("hasInstance", typeof value, this === Even);
    return value % 2 === 0;
  }
}
console.log(2 instanceof Even, 3 instanceof Even);
