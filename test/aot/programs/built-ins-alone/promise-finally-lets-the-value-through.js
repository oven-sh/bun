let state = "open";
const value = await Promise.resolve({ size: 1.5 }).finally(() => {
  state = 0.5;
  return "ignored";
});
console.log(value.size + 1, typeof state, state + 1);
