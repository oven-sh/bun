function F0() {
  function f3() {
    function f4() {}
  }
  function f5() {
    try {
    } catch (e7) {}
    return 1429326563;
  }
  Object.defineProperty(this, "42", { get: f5, set: f8 });
}
const v40 = {
  [Symbol]() {
    const v39 = {
      get next() {
        function f33() {}
      },
    };
  },
};
with (v40) {
}
printValue("F0", F0);
