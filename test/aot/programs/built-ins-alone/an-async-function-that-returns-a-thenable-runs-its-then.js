async function work() {
  return {
    then(resolve) {
      console.log("then");
      resolve(1.5);
    },
  };
}
console.log((await work()) + 1);
