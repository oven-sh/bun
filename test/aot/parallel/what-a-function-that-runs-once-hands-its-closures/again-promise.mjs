class Step extends Promise {
  constructor(executor) {
    super(executor);
    let work = 0;
    for (let i = 0; i < 2; i++) work = (work + i) | 0;
    let seen = work;
    this.bump = () => (seen = (seen + 1) | 0);
  }
}
const first = new Step((resolve) => resolve(5));
const second = first.then((x) => x + 1);
console.log(first.bump(), first.bump(), second.bump(), await second);
