const holder = {
  work(first, second) {
    return second.length;
  },
};
console.log(holder.work.bind(holder, 1, "two")());
