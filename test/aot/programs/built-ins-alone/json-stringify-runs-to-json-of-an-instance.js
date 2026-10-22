class Money {
  cents = 150;
  toJSON(key) {
    console.log("toJSON", typeof key, key);
    return this.cents / 100;
  }
}
console.log(JSON.stringify({ price: new Money() }), JSON.stringify([new Money()]), JSON.stringify(new Money()));
