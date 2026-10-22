const holder = {
  work(first, second) {
    return second.length;
  },
};
console.log(holder.work.apply(holder, [1, "two"]));
