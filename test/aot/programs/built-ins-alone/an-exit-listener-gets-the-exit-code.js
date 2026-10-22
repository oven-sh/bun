process.on("exit", code => {
  console.log(typeof code, code + 1);
});
