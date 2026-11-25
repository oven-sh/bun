function run(n) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let read = null;
  if (n > 3) {
    const size = (n + work) | 0;
    read = () => size * 2;
  }
  if (read !== null) work = read();
  return work;
}
console.log(run(JSON.parse("5")));
