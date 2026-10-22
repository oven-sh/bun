const last = await Promise.resolve(1.5)
  .then(value => `${value + 1}`)
  .then(value => ({ length: value.length }))
  .then(value => value.length + 0.5);
console.log(typeof last, last + 1);
