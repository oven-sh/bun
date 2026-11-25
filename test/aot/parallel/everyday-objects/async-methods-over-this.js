// Asynchronous methods that change fields of their instance between awaits
class Account {
  constructor(sum) {
    this.sum = sum;
    this.queue = Promise.resolve();
    this.log = [];
  }
  add(n) {
    return (this.queue = this.queue.then(async () => {
      const before = this.sum;
      await null;
      this.sum = before + n;
      this.log.push(this.sum);
      return this.sum;
    }));
  }
  async both(a, b) {
    const [x, y] = await Promise.all([this.add(a), this.add(b)]);
    return `${x} then ${y} of ${this.log.join("+")}`;
  }
}
async function run(sum) {
  const account = new Account(sum);
  console.log(await account.both(1, 2), await account.both(-sum, 5), account.sum);
}
run(0).then(() => run(100)).then(() => run(-7));
