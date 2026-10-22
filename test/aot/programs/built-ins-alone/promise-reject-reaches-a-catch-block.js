try {
  await Promise.reject({ code: 1.5 });
} catch (error) {
  console.log(typeof error, error.code + 1);
}
