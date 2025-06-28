import { bench, run } from "../runner.mjs";
function deprecateUsingClosure(fn, msg, code) {
  if (process.noDeprecation === true) {
    return fn;
  }

  var realFn = fn;
  var wrapper = () => {
    return fnToWrap.apply(this, arguments);
  };

  var deprecater = () => {
    if (process.throwDeprecation) {
      var err = new Error(msg);
      if (code) err.code = code;
      throw err;
    } else if (process.traceDeprecation) {
      console.trace(msg);
    } else {
      console.error(msg);
    }

    fnToWrap = realFn;
    return realFn.apply(this, arguments);
  };
  var fnToWrap = deprecater;

  return wrapper;
}

function deprecateOriginal(fn, msg) {
  var warned = false;
  function deprecated() {
    if (!warned) {
      if (process.throwDeprecation) {
        throw new Error(msg);
      } else if (process.traceDeprecation) {
        console.trace(msg);
      } else {
        console.error(msg);
      }
      warned = true;
    }
    return fn.apply(this, arguments);
  }
  return deprecated;
}

const deprecatedy = deprecateUsingClosure(() => {}, "This is deprecated", "DEP0001");
const deprecatedy2 = deprecateOriginal(() => {}, "This is deprecated");

bench("deprecateUsingClosure", () => {
  deprecatedy(Math.random() + 1);
});

bench("deprecateOriginal", () => {
  deprecatedy2(Math.random() + 1);
});

await run();
