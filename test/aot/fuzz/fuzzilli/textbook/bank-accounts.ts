interface Account {
  id: number;
  balance: number;
}
function moved(accounts: Account[], from: number, to: number, sum: number): boolean {
  const source = accounts.find(account => account.id === from);
  const target = accounts.find(account => account.id === to);
  if (!source || !target || source.balance < sum) return false;
  source.balance -= sum;
  target.balance += sum;
  return true;
}
const accounts: Account[] = [
  { id: 1, balance: 100 },
  { id: 2, balance: 5 },
];
console.log(moved(accounts, 1, 2, 30), moved(accounts, 2, 1, 500), moved(accounts, 1, 9, 1), JSON.stringify(accounts));
