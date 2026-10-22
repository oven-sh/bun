try {
  await Promise.any([Promise.reject({ code: 1.5 }), Promise.reject("two")]);
} catch (error) {
  console.log(error instanceof AggregateError, error.errors.length, error.errors[0].code + 1, error.errors[1].length);
}
