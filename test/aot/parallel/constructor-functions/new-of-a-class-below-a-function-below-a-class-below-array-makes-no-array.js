class List extends Array {}
function Other() {}
Other.prototype = Object.create(List.prototype);
class Below extends Other {
  constructor() {
    super();
    this.kept = 1;
  }
}

const plain = new Below();
console.log(Array.isArray(plain), plain.length, plain.push(7), plain.length, plain[0], JSON.stringify(plain), Object.keys(plain).join());

const list = Reflect.construct(List, [], Below);
console.log(Array.isArray(list), list.length, list.push(7), list.length, list[0], JSON.stringify(list), Object.keys(list).join());

let sum = 0;
for (let i = 0; i < 5000; i++) {
  const made = new Below();
  if (Array.isArray(made)) sum++;
  sum += made.length + made.push(i) * 10 + made.length * 100;
}
console.log(sum);
