// `bun:python`: what JS needs to talk to Python besides importing `.py` files.
//
//   kwargs({ name: value })  as the last argument of a call of something in Python: name=value
//   float(2)                 the float 2.0 (a whole number is an int to Python)
//   import("os.path")        the module, as `import os.path` finds it
//
// The object is made by JavaScriptCore: vendor/WebKit/Source/JavaScriptCore/python/runtime/PyJSView.cpp.
export default $cpp("BunPython.cpp", "Bun::createPythonNamespace");
