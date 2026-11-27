// STATISTIC: ReceiversOfCalleesToldApart >= 1
// A function that a loop calls asks its first argument, one of two kinds that the loop never changes, for a method: the kinds are told apart once, in front of the loop.
"use strict";
class Till {
  constructor(coin) {
    this.coin = coin;
    this.asked = 0;
  }
  worth(n) {
    this.asked++;
    return n * this.coin;
  }
}
class Purse {
  constructor(coin) {
    this.coin = coin;
    this.torn = false;
  }
  worth(n) {
    return this.torn ? 0 : n + this.coin;
  }
}
function paid(holder, n) {
  return holder.worth(n) + 1;
}
function total(which, list) {
  const holder = which ? new Till(3) : new Purse(2);
  let sum = 0;
  for (let k = 0; k < list.length; k++) sum += paid(holder, list[k]);
  return sum + (which ? holder.asked : 0);
}
const whole = [];
const parts = [];
for (let n = 0; n < 3000; n++) {
  whole.push(n & 31);
  parts.push(n / 8);
}
console.log(total(true, whole), total(false, whole), total(true, parts), total(false, parts));
console.log(total(true, [1, undefined, 2]), total(false, ["4", 1]), total(false, []), total(true, [-0, 2 ** 31]));
