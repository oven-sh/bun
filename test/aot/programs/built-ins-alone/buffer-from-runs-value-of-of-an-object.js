const holder = {
  count: 0,
  valueOf() {
    this.count++;
    return "hi";
  },
};
console.log(Buffer.from(holder).toString(), holder.count);
