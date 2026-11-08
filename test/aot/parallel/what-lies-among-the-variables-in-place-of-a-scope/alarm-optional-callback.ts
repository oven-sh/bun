function run(n: number): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let read: (() => number) | undefined;
  switch (n) {
    case 5: {
      const size = (n + work) | 0;
      read = () => size + 1;
      break;
    }
    default:
      work = 7;
  }
  return read?.() ?? work;
}
console.log(run(JSON.parse("5")));
