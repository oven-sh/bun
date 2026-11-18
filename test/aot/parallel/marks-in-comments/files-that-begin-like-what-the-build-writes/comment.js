/*@bun*/ const place = new Error().stack.match(/:(\d+:\d+)/)[1];
module.exports = 1;
console.log(place, typeof require, typeof module, typeof exports, typeof this, typeof __filename);
