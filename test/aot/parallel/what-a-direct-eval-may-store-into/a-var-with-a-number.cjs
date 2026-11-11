function outer(code) {
  var count = 0;
  function bump() { count += 1; return count; }
  bump();
  eval(code);
  return String(bump());
}
console.log(outer("count = 'a'"), outer(""), outer("count = { valueOf() { return 40; } }"));
