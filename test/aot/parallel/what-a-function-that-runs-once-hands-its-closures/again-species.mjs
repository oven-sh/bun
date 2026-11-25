class Ledger extends Array {
  constructor(...items) {
    super(...items);
    let work = 0;
    for (let i = 0; i < 2; i++) work = (work + i) | 0;
    let seen = work;
    this.bump = () => (seen = (seen + 1) | 0);
  }
}
const first = new Ledger(4, 5, 6);
const second = first.map((x) => x + 1);
console.log(first.bump(), first.bump(), second.bump());
