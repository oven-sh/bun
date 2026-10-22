let state = "open";
{
  using resource = {
    [Symbol.dispose]() {
      state = 0.5;
    },
  };
  console.log(typeof resource, state);
}
console.log(typeof state, state + 1);
