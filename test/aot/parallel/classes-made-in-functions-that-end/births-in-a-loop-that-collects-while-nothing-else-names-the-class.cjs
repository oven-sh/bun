"use strict";
function makeCoin(tag) {
  var mint = { text: "coin" + tag, rows: new Array(500).fill(tag) };
  function Coin(n) { this.n = n; }
  Coin.prototype.worth = function () { return mint.rows[0] + this.n; };
  Coin.prototype.mint = function () { return mint.text; };
  return Coin;
}
function spend(tag) {
  const Coin = makeCoin(tag);
  let sum = 0;
  for (let i = 0; i < 400; i++) {
    const pad = [i, i + 1, { i }];
    if (i % 50 === 49) Bun.gc(true);
    sum += new Coin(pad.length).worth();
  }
  return sum;
}
console.log(spend(1), spend(2), spend(3));
