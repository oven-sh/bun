// `bun:python`: what JS needs to talk to Python besides importing `.py` files.
//
//   kwargs({ name: value })  as the last argument of a call of something in Python: name=value
//   float(2)                 the float 2.0 (a whole number is an int to Python)
//   import("os.path")        the module, as `import os.path` finds it
//   method(function () {})   a function for Python that takes its first argument as `this`
//   with(manager, body)      with manager as value: return body(value)
//   asyncWith(manager, body) async with manager as value: return await body(value)
//   enter(manager)           using entered = enter(manager): `with manager as entered.value:`, to the end of the block
//   enterAsync(manager)      await using entered = await enterAsync(manager): the same for `async with`
//
// The object is made by JavaScriptCore (vendor/WebKit/Source/JavaScriptCore/python/runtime/PyJSView.cpp); the last four are
// from src/python/_bun_python.py.
const python = $cpp("BunPython.cpp", "Bun::createPythonNamespace");

// In Python they return (value, __exit__).
const { enter: enterInPython, enterAsync: enterAsyncInPython } = python;

// JS does not tell a disposable of the exception that leaves the block, so neither does __exit__ hear of it.
class Entered {
  value;
  #exit;

  constructor(entered) {
    this.value = entered[0];
    this.#exit = entered[1];
  }

  [Symbol.dispose]() {
    const exit = this.#exit;
    this.#exit = undefined;
    exit?.(undefined, undefined, undefined);
  }
}

class EnteredAsync {
  value;
  #exit;

  constructor(entered) {
    this.value = entered[0];
    this.#exit = entered[1];
  }

  async [Symbol.asyncDispose]() {
    const exit = this.#exit;
    this.#exit = undefined;
    await exit?.(undefined, undefined, undefined);
  }
}

python.enter = function enter(manager) {
  return new Entered(enterInPython(manager));
};
python.enterAsync = async function enterAsync(manager) {
  return new EnteredAsync(await enterAsyncInPython(manager));
};

export default python;
