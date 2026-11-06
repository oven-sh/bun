module.exports = {
  get first() { console.log("literal: first getter runs"); return 1; },
  second: 2,
  get third() { console.log("literal: third getter runs"); return 3; },
};
console.log("literal ends");
