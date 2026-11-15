function run(n) {
  let first = 0,
    onlyOnce = 0,
    later = 0;
  const begin = () => {
    first = 1;
  };
  const once = () => {
    onlyOnce = onlyOnce + 1;
  };
  const after = () => {
    later = later + 1;
  };
  let i = 0;
  while (i !== n) {
    if (first === 0) once();
    else after();
    begin();
    i = i + 1;
  }
  return [first, onlyOnce, later].join();
}
console.log([run(0), run(1), run(2), run(5)].join(" . "));
