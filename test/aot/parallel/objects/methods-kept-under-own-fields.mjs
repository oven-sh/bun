// The same method, stored, returned and compared with what it stands for.
class A {
  count = 2;
  size(x) {
    return this.count;
  }
  name(x) {
    return this.count + 1;
  }
}
function keep(all) {
  const kept = [];
  for (const one of all) {
    const read = one.size;
    if (read === one.size && read !== kept[0]) kept.push(read);
  }
  return kept;
}
function pick(one) {
  for (let turn = 0; turn < 3; turn++) if (one.size === one.name) return one.size;
  return null;
}
const o = new A();
o.size = A.prototype.name;
console.log(keep([o, new A(), new A(), o]).length, pick(o) === A.prototype.name, pick(new A()));
