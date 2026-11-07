// compatibility.mdx, "Smaller differences". `bun run` evaluates the value first: "value,key 1".
const order = [];
const key = {
  toString() {
    order.push("key");
    return "name";
  },
};
const made = { [key]: order.push("value") };
console.log(order.join(), made.name);
/* Output:
key,value 2
*/
