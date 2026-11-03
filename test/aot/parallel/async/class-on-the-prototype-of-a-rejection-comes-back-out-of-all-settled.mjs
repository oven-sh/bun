const promise = Promise.allSettled([Promise.reject(Object.create({ inner: class { tag() { return 1; } } }))]);
const taken = (await promise)[0].reason.inner;
console.log(new taken().tag());
