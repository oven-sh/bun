const PRICE = 1234.5;
const RATE = 0.0825;
const tax = PRICE * RATE;
console.log(PRICE.toFixed(2), tax.toFixed(2), (PRICE + tax).toFixed(2), Math.round(tax * 100) / 100, (RATE * 100).toFixed(2) + "%", PRICE.toLocaleString("en-US", { style: "currency", currency: "USD" }));
