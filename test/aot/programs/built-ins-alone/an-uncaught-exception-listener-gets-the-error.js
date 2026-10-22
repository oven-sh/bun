process.on("uncaughtException", (error, origin) => {
  console.log(typeof error, error.code + 1, origin);
});
setTimeout(() => {
  throw { code: 1.5 };
}, 0);
