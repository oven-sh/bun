// Super in an object literal follows the prototype: compiled answers as plain.
const base = {
    m() {
      return "base";
    },
  },
  other = {
    m() {
      return "other";
    },
  };
const o = {
  __proto__: base,
  m() {
    return "o>" + super.m();
  },
};
console.log(o.m());
Object.setPrototypeOf(o, other);
console.log(o.m());
