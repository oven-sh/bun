const holder = {
  work(first, second) {
    return second.length;
  },
};
console.log(Reflect.apply(holder.work, holder, [1, "two"]));
