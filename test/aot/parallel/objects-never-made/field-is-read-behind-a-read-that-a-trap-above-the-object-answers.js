// The prototype object of the constructor function is a Proxy: its trap is handed the receiver of a read that the object itself does not answer, and stores into it.
function Bare() {
  this.n = 5;
}
Bare.prototype = new Proxy(
  {},
  {
    get(target, key, receiver) {
      if (typeof key === "string" && key === "add") receiver.n = 50;
      return undefined;
    },
  },
);
function once(i) {
  const bare = new Bare();
  const add = bare.add;
  return bare.n + i + (add === undefined ? 0 : 1000);
}
let text = "";
for (let i = 0; i < 4; i++) text += once(i) + " ";
console.log(text);
