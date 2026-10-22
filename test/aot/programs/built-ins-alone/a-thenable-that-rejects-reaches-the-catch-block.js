const thenable = {
  then(resolve, reject) {
    reject({ code: 1.5 });
  },
};
try {
  await Promise.resolve(thenable);
} catch (error) {
  console.log(typeof error, error.code + 1);
}
