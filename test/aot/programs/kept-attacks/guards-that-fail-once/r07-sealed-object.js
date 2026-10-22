// Guards that fail once: sealed object. It prints what plain Bun prints.
const trip = process.argv[2] === "trip";
const N = Number(process.argv[3] ?? 10000000);
const variant = process.argv[4] ?? "seal";

class Account {
  constructor(balance) {
    this.balance = balance;
    this.moves = 0;
  }
}
const account = new Account(1);
if (trip && variant === "seal") Object.seal(account);
if (trip && variant === "preventExtensions") Object.preventExtensions(account);

function run(object) {
  let sum = 0;
  for (let i = 0; i < N; i++) {
    object.balance = i & 7;
    object.moves = i & 3;
    sum = (sum + object.balance + object.moves) | 0;
  }
  return sum;
}
console.log(variant, run(account));
