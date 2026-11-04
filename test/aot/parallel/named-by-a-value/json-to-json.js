class Money { toJSON() { return "5 EUR"; } }
console.log(JSON.stringify({ price: new Money() }));
