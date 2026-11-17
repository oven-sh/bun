class Account {
  owner: string;
  balance = 0;
  constructor(owner: string) {
    this.owner = owner;
  }
  deposit(sum: number) {
    this.balance += sum;
    return this;
  }
}
function run() {
  const account = new Account("ann").deposit(5).deposit(7);
  console.log(account.balance, account.owner, JSON.stringify(account), Object.keys(account).join());
}
run();
