(function once() {
  let counter = 0;
  function bump() {
    counter++;
  }
  bump();
  console.log("declared with a value", counter);
})();

(function once() {
  let counter;
  function set() {
    counter = 5;
  }
  function read() {
    return counter;
  }
  console.log("before the store", read());
  set();
  console.log("after the store", read());
})();

(function once() {
  function early() {
    return typeof late;
  }
  try {
    console.log("in the dead zone", early());
  } catch (error) {
    console.log("in the dead zone threw", error.constructor.name);
  }
  let late = 1;
  function bump() {
    late += 1.5;
  }
  bump();
  console.log("after the declaration", early(), late);
})();

function many(start) {
  let total = start;
  const add = n => {
    total += n;
  };
  for (let i = 0; i < 3; i++) add(i);
  return total;
}
console.log("called three times", many(0), many(1.5), many("a"));
