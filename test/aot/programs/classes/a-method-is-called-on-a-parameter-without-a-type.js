class Item {
  constructor(value) {
    this.value = value;
  }
  method(i) {
    return this.value + (i & 1);
  }
}
class Heir extends Item {
  method(i) {
    return super.method(i) * 2;
  }
}
const literal = {
  value: 5,
  method(i) {
    return this.value - i;
  },
};
const withField = { value: 7, method: i => i * 3 };
const below = Object.create({
  method(i) {
    return this.value + i * 100;
  },
});
below.value = 1;
const changed = new Item(9);
changed.method = function (i) {
  return -this.value - i;
};

function callEach(a, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += a.method(i);
  return sum;
}

const table = { callEach };
const name = ["call", "Each"].join("");
for (const receiver of [new Item(3), new Heir(4), literal, withField, below, changed, new Item("s")]) console.log(table[name](receiver, 5));
Item.prototype.method = function (i) {
  return this.value * 10 + i;
};
console.log(table[name](new Item(3), 5), table[name](new Heir(4), 5), table[name](changed, 5));
for (const receiver of [{ value: 1 }, null, 4]) {
  try {
    console.log(table[name](receiver, 2));
  } catch (error) {
    console.log(error instanceof TypeError);
  }
}
