async function f(code) {
  switch (code) {
    case 1:
      async function later(n) {
        await null;
        return n + 1;
      }
      function* numbers() {
        yield 1;
        yield 2;
      }
      {
        return [await later(1), ...numbers()];
      }
  }
}
console.log(JSON.stringify(await f(1)), await f(2));
