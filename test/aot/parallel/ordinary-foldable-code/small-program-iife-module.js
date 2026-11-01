const counter = (function () {
  let count = 0;
  const STEP = 2;
  return {
    next() {
      count += STEP;
      return count;
    },
    get value() {
      return count;
    },
  };
})();
counter.next();
counter.next();
console.log(counter.value, counter.next());
