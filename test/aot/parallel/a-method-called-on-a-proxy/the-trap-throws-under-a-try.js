// The trap of a Proxy throws while a method is read for a call: the arguments stand, the handler around the call catches, and the next call goes on.
let turn = 0;
const proxy = new Proxy(
  { twice: (x) => x * 2 },
  {
    get(target, name) {
      if (++turn % 3 === 0)
        throw new RangeError("turn " + turn + " of " + String(name));
      return target[name];
    },
  },
);
function run(holder, list) {
  const said = [];
  for (const item of list) {
    try {
      said.push(holder.twice(item));
    } catch (error) {
      said.push(error.name + ": " + error.message + " at " + item);
    } finally {
      said.push("|");
    }
  }
  return said.join(" ");
}
console.log(run(proxy, [1, 2, 3, 4, 5, 6, 7]));
function uncaught(holder) {
  return holder.twice(21);
}
try {
  console.log(uncaught(proxy), uncaught(proxy), uncaught(proxy));
} catch (error) {
  console.log("outside:", error.message);
}
