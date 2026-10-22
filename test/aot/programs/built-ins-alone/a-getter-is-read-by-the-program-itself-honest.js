const holder = {
  count: 0,
  get size() {
    this.count++;
    return 1.5;
  },
};
console.log(holder.size + 1, holder.count);
