class C {
  constructor() {
    this.first = 1;
    this.second = "s";
  }
  set(v) {
    this.first = v;
    this.second = v + "!";
    return this.first;
  }
}
const o = new C();
for (let i = 0; i < 70000; i++) o["k" + i] = i;
const name = ["fir", "st"].join("");
console.log(o.set(5), o.first, o[name], o.second, Object.entries(o)[0].join(), Object.entries(o)[1].join(), JSON.stringify(o).slice(0, 28), Object.getOwnPropertyDescriptor(o, "first").value, { ...o }.first, Object.assign({}, o).second, Reflect.get(o, "first"), Object.values(o)[0]);
o[name] = 9;
console.log(o.first, o.set(o.first + 1), o[name], structuredClone(o).first);
