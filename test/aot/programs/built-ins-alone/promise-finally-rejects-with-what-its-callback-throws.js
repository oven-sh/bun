try {
  await Promise.resolve(1).finally(() => {
    throw { code: 1.5 };
  });
} catch (error) {
  console.log(error.code + 1);
}
