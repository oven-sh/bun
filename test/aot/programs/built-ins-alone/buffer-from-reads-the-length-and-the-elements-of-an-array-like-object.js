const like = {
  count: 0,
  get length() {
    this.count++;
    return 2;
  },
  get 0() {
    this.count++;
    return 104;
  },
  1: 105,
};
console.log(Buffer.from(like).toString(), like.count);
