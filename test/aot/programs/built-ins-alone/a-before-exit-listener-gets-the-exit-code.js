process.once("beforeExit", code => {
  console.log(typeof code, code + 1);
});
