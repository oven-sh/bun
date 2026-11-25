// `bun run` does not call return(): "next ReferenceError".
const order = [];
const source = {
  [Symbol.iterator]() {
    return {
      next() {
        order.push("next");
        return { done: false, value: undefined };
      },
      return() {
        order.push("return");
        return {};
      },
    };
  },
};
try {
  let [first = late] = source;
  let late = 1;
  order.push(first + late);
} catch (error) {
  order.push(error.name);
}
console.log(order.join(" "));
/* Output:
next return ReferenceError
*/
