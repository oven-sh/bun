// Object literals whose keys in brackets are objects that count their conversions, beside values that read the count. Plain Bun prints another output.
let count = 0;
const byToString = {
  toString() {
    count++;
    return "a";
  },
};
const byValueOf = {
  toString: undefined,
  valueOf() {
    count++;
    return "b";
  },
};
const byToPrimitive = {
  [Symbol.toPrimitive]() {
    count++;
    return "c";
  },
};
function read() {
  return count;
}

console.log(JSON.stringify({ [byToString]: count }));
console.log(JSON.stringify({ [byValueOf]: count }));
console.log(JSON.stringify({ [byToPrimitive]: count }));
console.log(JSON.stringify({ before: count, [byToString]: count, between: count, [byValueOf]: count, after: count }));
console.log(JSON.stringify({ [byToString]: read() }));
console.log(JSON.stringify({ [byToString]: [count], [byToPrimitive]: { inner: count } }));

const order = [];
const noted = {
  toString() {
    order.push("key");
    return "d";
  },
};
const made = { [noted]: order.push("value"), [noted]: order.push("second value") };
console.log(order.join(", "), JSON.stringify(made));
console.log(count);
/* Output:
{"a":1}
{"b":2}
{"c":3}
{"before":3,"a":4,"between":4,"b":5,"after":5}
{"a":6}
{"a":[7],"c":{"inner":8}}
key, value, key, second value {"d":4}
8
*/
