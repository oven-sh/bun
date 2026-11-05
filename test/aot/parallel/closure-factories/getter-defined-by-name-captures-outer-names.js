// A method of a prototype object defines a getter under a name it is given, and the getter captures two outer names. The compiler copies the method for each name.
// Flags: --aot-validate
(() => {
  const table = new Map();
  const prefix = String(process.argv.length > 99 ? 1 : "p-");
  function Helper() {}
  Helper.prototype.define = function (target) {
    Object.defineProperty(this, target, {
      get() {
        return prefix + target + table.size;
      },
      enumerable: true,
    });
    table.set(target, this);
  };
  const helper = new Helper();
  try {
    helper.define("alpha");
    helper.define("beta");
  } catch (error) {
    console.log("caught", error.name);
  }
  console.log(helper.alpha, helper.beta, table.size, Object.keys(helper).join());
})();
