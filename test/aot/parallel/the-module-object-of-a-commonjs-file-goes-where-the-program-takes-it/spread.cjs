const copy = { ...module };
console.log(typeof copy.exports, typeof copy.require, typeof copy.filename);
