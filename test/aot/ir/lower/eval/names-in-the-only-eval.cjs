// RUN(ONLY): lower
// ONLY-LABEL: function {{*}}name="only"
// ONLY: = Builtin builtin=String
// ONLY-NOT: isFreeName
// ONLY: Return

// RUN(SECOND): lower
// SECOND-LABEL: function {{*}}name="second"
// SECOND: key="String" [isFreeName]
// SECOND: Return

// RUN(LOOP): lower
// LOOP-LABEL: function {{*}}name="repeated"
// LOOP: key="String" [isFreeName]
// LOOP: Return

// No eval declares a name that a known text of the only eval of its function names, where the eval runs once in an activation.
function beside(text) {
  return eval(text);
}

function twice(text, other) {
  eval(other);
  return eval(text);
}

function loop(text, count) {
  let made;
  for (let i = 0; i < count; i++) made = eval(text);
  return made;
}

module.exports = [
  beside,
  beside("(function only() { return String.length; })"),
  twice,
  twice("(function second() { return String.length; })", "1"),
  loop,
  loop("(function repeated() { return String.length; })", 2),
];
