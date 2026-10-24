// A sealed object and an object that is not extensible take stores to the properties they have and refuse new ones, a frozen object refuses both, and a definition of a class field needs an extensible object.
class Account {
  constructor(balance) {
    this.balance = balance;
    this.moves = 0;
  }
}
class Closed {
  constructor(how) {
    this.first = 1;
    how(this);
  }
}
class BelowClosed extends Closed {
  second = 2;
}

function replace(account, amount) {
  account.balance = amount;
  account.moves = account.moves + 1;
  return account.balance + account.moves;
}
function create(account, note) {
  account.note = note;
  return account.note;
}
function createByKey(account, key, note) {
  account[key] = note;
  return account[key];
}
function remove(account) {
  return delete account.moves;
}
function attempt(name, action) {
  try {
    return `${name} ${action()}`;
  } catch (error) {
    return `${name} ${error.constructor.name}`;
  }
}

const ways = {
  open: object => object,
  preventExtensions: Object.preventExtensions,
  seal: Object.seal,
  freeze: Object.freeze,
};
for (const [way, change] of Object.entries(ways)) {
  const account = new Account(1);
  let sum = 0;
  for (let i = 0; i < 100; i++) sum += replace(account, i);
  change(account);
  const lines = [];
  for (let i = 0; i < 3; i++) lines.push(attempt("replace", () => replace(account, 10 + i)));
  lines.push(attempt("create", () => create(account, "a")));
  lines.push(attempt("createByKey", () => createByKey(account, "other", "b")));
  lines.push(attempt("remove", () => remove(account)));
  lines.push(attempt("createAgain", () => replace(account, 20)));
  lines.push(attempt("define", () => Object.keys(new BelowClosed(change)).join()));
  console.log(way, sum, lines.join(" | "), JSON.stringify(account), Object.isExtensible(account), Object.isSealed(account), Object.isFrozen(account));
}

const late = new Account(5);
create(late, "early");
Object.seal(late);
console.log(attempt("storeToLateField", () => create(late, "later")), JSON.stringify(late));
