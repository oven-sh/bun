function outer(code) {
  const reader = () => typeof arguments;
  eval(code);
  return typeof arguments + " " + reader();
}
console.log(outer("arguments = 5"), outer(""));
