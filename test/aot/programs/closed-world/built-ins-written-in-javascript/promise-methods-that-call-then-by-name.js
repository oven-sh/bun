// catch and finally are functions of Bun's library that call `this.then(..)`. The program never names `then`, and it is in the executable all the same.
Promise.reject(1).catch(reason => console.log("caught", reason));
Promise.resolve(2).finally(() => console.log("finally"));
Promise.all([Promise.resolve(3)]).finally(() => console.log("all"));
