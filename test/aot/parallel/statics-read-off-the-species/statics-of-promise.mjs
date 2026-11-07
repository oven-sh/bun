const P = Promise[Symbol.species];
console.log(
  (await P.all([1, P.resolve(2)])).join(),
  (await P.allSettled([P.reject(1)]))[0].status,
  await P.any([P.reject(1), 3]),
  await P.race([4]),
  typeof P.withResolvers().resolve,
  await P.try(() => 5),
);
