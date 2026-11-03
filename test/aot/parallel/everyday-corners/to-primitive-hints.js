// To primitive hints: compiled answers as plain.
const hints = [];
const o = {
  [Symbol.toPrimitive](h) {
    hints.push(h);
    return h === "number" ? 1 : "s";
  },
};
console.log(+o, `${o}`, o + "", o * 2, o == "s", [o] + "", o < 2, hints.join());
