// An entry that is a CommonJS file exports an object that holds built-in functions. They are read off the entry later and called.
module.exports = { map: Array.prototype.map, list: [Array.prototype.filter] };
module.exports.late = { some: Array.prototype.some };

setTimeout(async () => {
  const word = letters => letters.join("");
  const self = (await import(Bun.main)).default;
  console.log(Object.keys(self).join());
  console.log(self[word(["m", "ap"])].call([1, 2], x => x + 1).join());
  console.log(self[word(["li", "st"])][0].call([1, 2], x => x > 1).join());
  console.log(self[word(["la", "te"])].some.call([1, 2], x => x > 2));
}, 0);
