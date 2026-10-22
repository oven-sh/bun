const promise = new Promise(resolve => {
  resolve({
    then(settle) {
      console.log("then");
      settle(1.5);
    },
  });
});
console.log((await promise) + 1);
