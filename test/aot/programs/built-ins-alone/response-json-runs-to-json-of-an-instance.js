class Money {
  cents = 150;
  toJSON() {
    console.log("toJSON");
    return this.cents / 100;
  }
}
console.log(await Response.json({ price: new Money() }).text());
