const source = {
  [Symbol.asyncIterator]() {
    console.log("asyncIterator");
    let count = 0;
    return {
      next() {
        count++;
        return Promise.resolve(count > 2 ? { done: true, value: undefined } : { done: false, value: count + 0.5 });
      },
    };
  },
};
for await (const value of source) console.log(value + 1);
