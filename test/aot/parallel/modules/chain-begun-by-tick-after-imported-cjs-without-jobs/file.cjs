process.nextTick(() => {
  console.log("tick");
  let chain = Promise.resolve();
  for (let job = 1; job <= 12; job++) chain = chain.then(() => console.log("job", job));
});
exports.x = 1;
