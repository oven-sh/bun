const promise = Promise.resolve({ size: 1.5 });
let first;
await promise.then(value => {
  first = value;
});
await promise.then(value => console.log(value === first, value.size + 1));
