class Rows extends Array {
  static maker() {
    return super[Symbol.species];
  }
}
const below = { __proto__: Array };
console.log(Rows.maker() === Rows, Rows.maker().from("ab") instanceof Rows, below[Symbol.species] === below, below[Symbol.species].from("ab").length);
