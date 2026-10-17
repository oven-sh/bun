// reads two globals in a block that ends in a throw, in a function that is called by value
const throwers = [
  function (): never {
    throw [Error, globalThis];
  },
  function (): never {
    throw [Error, globalThis];
  },
];
const operations = 160;
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    try {
      throwers[i & 1]!();
    } catch (thrown) {
      if ((thrown as unknown[])[0] === Error) total++;
    }
  }
}

console.log(total);
