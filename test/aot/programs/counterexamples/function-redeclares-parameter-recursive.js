// Inside a function declaration that has the name of a parameter, the name is the function, not the argument.
function o(p) {
  function p(d) { return d ? p(0) : 7; }
  return p(1);
}
console.log(o(() => 100));
