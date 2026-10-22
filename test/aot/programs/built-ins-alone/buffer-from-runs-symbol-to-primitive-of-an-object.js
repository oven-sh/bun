const holder = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    this.count++;
    console.log(hint);
    return "hi";
  },
};
console.log(Buffer.from(holder).toString(), holder.count);
