function f(code) {
  const kept = [];
  for (let i = 0; i < 3; i++) {
    switch (code) {
      case 1:
        const here = i * 10;
        function helper() {
          return here;
        }
        kept.push(() => helper() + 1, helper);
    }
  }
  return kept.map(each => each());
}
console.log(JSON.stringify(f(1)), JSON.stringify(f(2)));
