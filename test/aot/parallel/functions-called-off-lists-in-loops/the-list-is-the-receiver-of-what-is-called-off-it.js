const list = [
  function (x) {
    return this.length + x;
  },
  function (x) {
    return this === list ? x * 2 : -1;
  },
  x => typeof this + x,
];
function run() {
  let out = "";
  for (let i = 0; i < 6; i++) out += list[i % 3](i) + ";";
  return out;
}
console.log(run());
list.push(() => 0);
console.log(run());
