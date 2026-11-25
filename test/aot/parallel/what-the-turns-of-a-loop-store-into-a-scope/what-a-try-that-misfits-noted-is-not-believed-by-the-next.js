function run(n) {
  let flag = 0,
    all = "";
  const set = () => {
    flag = flag + 1;
  };
  let i = 0;
  while (i !== n) {
    const x = flag === 0 ? 1 : "s";
    const y = flag === 2 ? { toString: () => "o" } : x;
    all = all + (x + 1) + "|" + y + ",";
    set();
    i = i + 1;
  }
  return all;
}
console.log([run(0), run(1), run(2), run(4)].join(" . "));
