try {
  await Promise.reject({ code: 1.5 }).finally(() => {});
} catch (error) {
  console.log(error.code + 1);
}
