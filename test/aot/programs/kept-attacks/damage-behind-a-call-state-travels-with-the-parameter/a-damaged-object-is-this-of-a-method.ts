// A method reads the fields of `this`. The caller has read the object and calls the method directly. Between the two a call damages the object, and the method is called again from inside another method.
class Account {
  balance: number;
  rate: number;
  constructor(balance: number, rate: number) {
    this.balance = balance;
    this.rate = rate;
  }
  interest(): number {
    return this.balance * this.rate;
  }
  report(): string {
    return this.balance + "*" + this.rate + "=" + this.interest();
  }
}

let mode = 0;
function audit(account: Account): void {
  if (mode === 1) delete (account as any).rate;
  else if (mode === 2) Object.defineProperty(account, "balance", { get: () => 1000 });
  else if (mode === 3) (account as any).rate = "2";
  else if (mode === 4) (account as any).interest = () => -1;
}

function holder(account: Account): string {
  const before = account.interest();
  audit(account);
  return before + " " + account.interest() + " " + account.report();
}

for (let round = 0; round < 500; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  const line = holder(new Account(round, 3));
  if (mode !== 0 || round % 100 === 0) console.log(round + ": " + line);
}
