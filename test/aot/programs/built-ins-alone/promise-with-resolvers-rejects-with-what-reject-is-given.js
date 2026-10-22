const { promise, reject } = Promise.withResolvers();
reject({ code: 1.5 });
try {
  await promise;
} catch (error) {
  console.log(error.code + 1);
}
