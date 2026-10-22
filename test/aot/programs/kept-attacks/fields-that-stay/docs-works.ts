// Fields that stay: docs works. It prints what plain Bun prints.
class Account {
  id: number = 1;
  owner: string = "ada";
  note?: string = "vip";
}

const account: any = new Account();
console.log(delete account.note);
account.id = null;
account.tags = ["new"];
Object.defineProperty(account, "owner", { value: "grace" });
Object.freeze(account);
console.log(JSON.stringify(account), Object.isFrozen(account));
