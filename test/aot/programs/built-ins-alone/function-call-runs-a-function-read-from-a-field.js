const holder = {
  work(first, second) {
    return second.length;
  },
};
console.log(holder.work.call(holder, 1, "two"));
