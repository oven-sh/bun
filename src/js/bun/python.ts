// `bun:python`: what JS needs to talk to Python besides importing `.py` files.
//
//   kwargs({ name: value })  as the last argument of a call of something in Python: name=value
//   float(2)                 the float 2.0 (a whole number is an int to Python)
//   import("os.path")        the module, as `import os.path` finds it
//   method(function () {})   a function for Python that takes its first argument as `this`
//   with(manager, body)      with manager as value: return body(value)
//   asyncWith(manager, body) async with manager as value: return await body(value)
//
// The object is made by JavaScriptCore (vendor/WebKit/Source/JavaScriptCore/python/runtime/PyJSView.cpp); the last two are
// from src/python/_bun_python.py.
export default $cpp("BunPython.cpp", "Bun::createPythonNamespace");
