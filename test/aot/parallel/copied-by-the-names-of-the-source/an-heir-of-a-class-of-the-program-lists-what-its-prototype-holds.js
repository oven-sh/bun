// What a function of the program lays on its prototype can be listed, and is read off an instance that nobody knows.
function Made() {
  this.own = "own";
}
Made.prototype.laid = function () {
  return "laid by the program";
};
function callAll(source) {
  const answers = [];
  for (const key in source) answers.push(typeof source[key] === "function" ? source[key]() : source[key]);
  return answers.join(" ");
}
console.log(callAll([JSON.parse("{}"), new Made()][1]));
