function OldAccount(owner, balance) {
  this.owner = owner;
  this.balance = balance;
}
OldAccount.prototype.deposit = function (amount) {
  this.balance += amount;
  return this.balance;
};

module.exports = function lookalikes(Account) {
  class Savings extends Account {
    deposit(amount) {
      return "savings " + super.deposit(amount * 2);
    }
  }
  return {
    real: function () { return new Account("real", 1); },
    heir: function () { return new Savings("heir", 1); },
    old: function () { return new OldAccount("old", 1); },
    literal: function () { return { owner: "literal", balance: "1", deposit: function (amount) { return this.balance += amount; } }; },
    created: function () { return Object.create(Account.prototype); },
    proxied: function () { return new Proxy(new Account("proxied", 1), {}); },
    textBalance: function () { return new Account("text balance", "1"); },
    reparented: function () { return Object.setPrototypeOf(new Account("reparented", 1), OldAccount.prototype); },
  };
};
