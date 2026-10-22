function make(i) { return { id: i, get: () => i, add(n) { return this.id + n; } }; }
function copy(s) { return { ...s }; }
let out = 0, same = 0;
for (let i = 0; i < 1000; i++) {
  const source = make(i);
  const made = copy(source);
  made.id = 1;
  out += made.add(1) + source.add(1) + made.get();
  if (made.add === source.add && made.get === source.get) same++;
}
console.log(out, same);
