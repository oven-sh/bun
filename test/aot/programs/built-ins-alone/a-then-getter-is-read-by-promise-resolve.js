const holder = {
  get then() {
    console.log("then is read");
    return undefined;
  },
};
console.log((await Promise.resolve(holder)) === holder);
