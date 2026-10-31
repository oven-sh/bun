// Closure sees later store: compiled answers as plain.
function make() {
  let v = 1;
  const get = () => v;
  v = "two";
  return get;
}
console.log(make()(), typeof make()());
