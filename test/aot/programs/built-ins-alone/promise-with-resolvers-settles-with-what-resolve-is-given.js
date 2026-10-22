const { promise, resolve, reject } = Promise.withResolvers();
resolve({ size: 1.5 });
console.log((await promise).size + 1, typeof reject);
