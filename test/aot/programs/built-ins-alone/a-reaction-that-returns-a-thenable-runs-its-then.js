const promise = Promise.resolve(0).then(() => ({
  then(settle) {
    console.log("then");
    settle(1.5);
  },
}));
console.log((await promise) + 1);
