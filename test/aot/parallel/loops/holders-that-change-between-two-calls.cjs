// The holders of the calls of a loop, where a call takes one of them apart, lays another method on it or hands back another kind.
"use strict";
class Till {
  constructor(coin) {
    this.coin = coin;
  }
  worth(n) {
    return n * this.coin;
  }
}
class Purse {
  constructor(coin) {
    this.coin = coin;
    this.torn = false;
  }
  worth(n) {
    if (n === 7) this.torn = true;
    if (n === 9) this.worth = m => m * 100;
    return this.torn ? 0 : n + this.coin;
  }
}
class Chest extends Purse {
  worth(n) {
    return super.worth(n) * 2;
  }
}
function paid(holder, n) {
  return holder.worth(n) + 1;
}
function total(which, list) {
  const holder = which === 0 ? new Till(3) : which === 1 ? new Purse(2) : new Chest(5);
  const out = [];
  for (let k = 0; k < list.length; k++) out.push(paid(holder, list[k]));
  return out.join(" ");
}
for (let round = 0; round < 300; round++) total(round % 3, [1, 2, 3]);
for (let which = 0; which < 3; which++) console.log(total(which, [1, 2, 9, 3, 7, 4]), "|", total(which, [7, 9, 1]));
const worth = Till.prototype.worth;
Till.prototype.worth = function (n) {
  return worth.call(this, n) - 1;
};
console.log(total(0, [1, 2, 3]));
Object.defineProperty(Purse.prototype, "worth", { get: () => n => "p" + n, configurable: true });
console.log(total(1, [1, 2]));
try {
  console.log(total(2, [1, 2]));
} catch (error) {
  console.log(error.constructor.name);
}
delete Till.prototype.worth;
try {
  console.log(total(0, [1]));
} catch (error) {
  console.log(error.constructor.name);
}
