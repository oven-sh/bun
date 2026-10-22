const like = {
  [Symbol.match]: true,
  get source() {
    console.log("source");
    return "a+";
  },
  get flags() {
    console.log("flags");
    return "g";
  },
  constructor: Object,
};
const made = new RegExp(like);
console.log(made.source, made.flags);
