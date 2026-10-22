const list = await Array.fromAsync([1.5, Promise.resolve(2.5)], async (value, index) => {
  console.log(typeof value, index);
  return value * 2;
});
console.log(list.length, list[0] + 1, list[1] + 1);
