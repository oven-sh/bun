let settle;
const promise = new Promise(resolve => {
  settle = resolve;
});
settle({ size: 1.5 });
console.log((await promise).size + 1);
