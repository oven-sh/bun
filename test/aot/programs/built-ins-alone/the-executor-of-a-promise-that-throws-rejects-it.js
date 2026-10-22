try {
  await new Promise(() => {
    throw { code: 1.5 };
  });
} catch (error) {
  console.log(error.code + 1);
}
