function shorthand() { return "shorthand"; }
function original() { return "renamed"; }
function calledByMethod() { return "method"; }
function returnedByGetter() { return "getter"; }

module.exports = {
  shorthand,
  renamed: original,
  method() { return calledByMethod(); },
  get getter() { return returnedByGetter; },
};
