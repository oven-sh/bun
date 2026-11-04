function outer(text) {
  let f = () => 1;
  eval(text);
  return f();
}
function reads(text) {
  const g = () => 2;
  return eval(text) + g();
}
console.log(outer(""), outer("f = () => 5"), reads("g()"), reads("typeof g"));
