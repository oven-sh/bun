// The caller reads the method, then a field, then calls. Until somebody lays a getter under the name, through a value that nobody follows, the field holds what the constructor stored. The getter stores into the object that it is handed.
const handedBack = new Function("f", "return f;");
class Counter {
  constructor() {
    this.n = 1;
  }
  add(x) {
    this.n = (this.n + x) | 0;
    return this.n;
  }
}
function once(i) {
  const counter = new Counter();
  const add = counter.add;
  const before = counter.n;
  return add.call(counter, i) * 10000 + before;
}
let text = "";
for (let i = 0; i < 6; i++) {
  if (i === 3)
    Object.defineProperty(handedBack(Counter).prototype, "add", {
      get() {
        this.n = 500;
        return function (x) {
          return this.n + x;
        };
      },
    });
  text += once(i) + " ";
}
console.log(text);
