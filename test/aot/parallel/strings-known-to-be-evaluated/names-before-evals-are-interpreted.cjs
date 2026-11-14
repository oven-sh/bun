// The free names of a function with a direct eval are the global ones as long as no eval of the file has been interpreted.
// COUNT: operation:operationAOTScopeHasBinding = 0
// COUNTER: InterpretedEvalCode = 0
function formatted(input) {
  function h() { return String(Math.floor(input.length / 2)); }
  function m() { return Number(Math.max(1, 2)) + parseInt("3px"); }
  var parts = input.split("");
  for (var i = 0; i < parts.length; i++) if (parts[i] === "h" || parts[i] === "m") parts[i] = eval(parts[i] + "()");
  return parts.join("");
}
const shown = [];
for (let i = 0; i < 20; i++) shown.push(formatted("h:m"), formatted("m-h-m"));
console.log(shown.join(" "));
