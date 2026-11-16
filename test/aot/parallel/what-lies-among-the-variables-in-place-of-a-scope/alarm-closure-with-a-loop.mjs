function run(n) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let count;
  if (n > 3) {
    const size = (n + work) | 0;
    count = () => {
      let sum = 0;
      for (let i = 0; i < size; i++) sum = (sum + i) | 0;
      return sum;
    };
  }
  if (count) work = count();
  return work;
}
console.log(run(JSON.parse("5")));
