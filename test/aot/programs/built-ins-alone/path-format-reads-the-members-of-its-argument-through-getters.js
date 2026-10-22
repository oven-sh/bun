import path from "node:path";
const probe = {
  count: 0,
  get dir() {
    this.count++;
    return "/a";
  },
  get base() {
    this.count++;
    return "b.txt";
  },
};
console.log(path.format(probe), probe.count);
