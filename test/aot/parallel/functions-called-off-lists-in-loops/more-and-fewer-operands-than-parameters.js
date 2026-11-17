const list = [
  (a, b = 5) => a + b,
  (...all) => all.length,
  function () {
    return arguments.length;
  },
  (a, b, c) => [a, b, c].join(),
];
function run() {
  let out = "";
  for (let i = 0; i < 8; i++) out += list[i & 3](i) + "|" + list[i & 3](i, 1, 2, 3) + "|" + list[i & 3]() + ";";
  return out;
}
console.log(run());
