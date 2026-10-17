// makes an instance of a class whose constructor stores four arrow functions on `this`
class Store {
  value: number;
  read: () => number;
  add: (amount: number) => number;
  reset: () => void;
  self: () => Store;
  constructor(value: number) {
    this.value = value;
    this.read = () => this.value;
    this.add = amount => (this.value += amount);
    this.reset = () => {
      this.value = 0;
    };
    this.self = () => this;
  }
}
const operations = 100;
const stores: Store[] = [];
for (let i = 0; i < operations; i++) stores.push(new Store(0));
let total = 0;

kernel: {
  for (let i = 0; i < stores.length; i++) stores[i] = new Store(i);
  total += stores[7].read();
}

console.log(total);
