// Return value is read before finally: compiled answers as plain.
function f() {
  let x = 1;
  try {
    return x;
  } finally {
    x = 2;
  }
}
function g() {
  const o = { x: 1 };
  try {
    return o;
  } finally {
    o.x = 2;
  }
}
console.log(f(), g().x);
