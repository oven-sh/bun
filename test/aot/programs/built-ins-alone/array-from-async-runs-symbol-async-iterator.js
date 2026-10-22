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
const list = await Array.fromAsync(source);
console.log(list.length, list[0] + 1);
