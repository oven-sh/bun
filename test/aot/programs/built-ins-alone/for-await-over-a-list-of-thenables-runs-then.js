const thenable = {
  then(resolve) {
    console.log("then");
    resolve(1.5);
  },
};
for await (const value of [thenable]) console.log(value + 1);
