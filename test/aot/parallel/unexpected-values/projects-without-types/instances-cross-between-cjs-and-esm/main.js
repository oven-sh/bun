var attempt = require("./show").attempt;
var account = require("./account.mjs");
var lookalikes = require("./lookalikes")(account.Account);

console.log("this file is strict:", (function () {
  return this === undefined;
})());

var uses = {
  balance: function (value) { return value.balance; },
  deposit: function (value) { return value.deposit(5); },
  borrowedDeposit: function (value) { return account.Account.prototype.deposit.call(value, 5); },
  isAccount: account.Account.isAccount,
  balanceOf: account.Account.balanceOf,
  isInstance: function (value) { return value instanceof account.Account; },
  richest: function (value) { return account.richest([new account.Account("other", 0), value]); },
  keys: function (value) { return Object.keys(value).join(); },
};
var sum = 0;
for (var i = 0; i < 2000; i++) {
  var real = new account.Account("real", i);
  sum += uses.balance(real) + uses.deposit(real) + uses.borrowedDeposit(real) + uses.balanceOf(real) + uses.richest(real).length;
}
console.log("sum", sum);
Object.keys(lookalikes).forEach(function (maker) {
  Object.keys(uses).forEach(function (use) {
    attempt(use + "(" + maker + ")", function () {
      return uses[use](lookalikes[maker]());
    });
  });
});
