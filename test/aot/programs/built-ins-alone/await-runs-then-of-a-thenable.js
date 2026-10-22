const thenable = {
  then(resolve, reject) {
    console.log("then", typeof resolve, typeof reject, this === thenable);
    resolve(1.5);
  },
};
console.log((await thenable) + 1);
