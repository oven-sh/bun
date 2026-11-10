// The collector runs inside the get trap while the receiver and fresh arguments of the call wait in the frame of the stub that reads the method.
const proxy = new Proxy(
  { join: (a, b, c) => a.text + b.text + c.join("") },
  {
    get(target, name) {
      const waste = [];
      for (let i = 0; i < 200; i++) waste.push({ i, text: "w" + i });
      Bun.gc(true);
      return target[name];
    },
  },
);
function call(holder, i) {
  return holder.join({ text: "a" + i }, { text: "b" + i }, ["c", i]);
}
const said = [];
for (let i = 0; i < 12; i++) said.push(call(proxy, i));
console.log(said.join());
