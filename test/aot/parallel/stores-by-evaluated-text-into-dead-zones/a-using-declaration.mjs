// what `using` declares is a constant
function attempt(run) { try { return "answered " + String(run()); } catch (error) { return error.constructor.name; } }
function held() {
  const early = attempt(() => eval("resource = 2"));
  using resource = { [Symbol.dispose]() {} };
  return early + " | " + attempt(() => eval("resource = 2")) + " | " + typeof resource;
}
console.log(held());
