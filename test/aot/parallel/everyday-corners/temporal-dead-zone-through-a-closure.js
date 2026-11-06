// Temporal dead zone through a closure: compiled answers as plain.
function f() {
  const get = () => v;
  let r;
  try {
    r = get();
  } catch (e) {
    r = e.constructor.name;
  }
  let v = 1;
  return [r, get()].join();
}
console.log(f());
