Two parts.

A base class that takes no argument keeps its typed file in fd33a8f1f5. `module_types` lists each class with no constructor whose base class has only constructors with no parameters. For those the writer gives `arguments` the type of the empty list: `super(...arguments as any as [])`. On the base that shape was left out too (TS2556). The test is "a derived class with no constructor keeps its typed file where its base class takes no argument".

A base class that takes arguments still leaves the typed files out. On the base, with an annotated field `x: number = 1` in the derived class:

- a base class with a required parameter: TS2556, no typed files.
- a base class with optional or rest parameters (`Error`): a typed file with `constructor() { super(...arguments); }`.

That typed file says that the class takes no argument, so `new HttpError("gone")` of a program is TS2554 against the package. The sources accept it. The warning replaces that typed file.

`...args: ConstructorParameters<typeof A>` with `super(...args)` is other JavaScript than `index.js` has, and `ConstructorParameters` has one overload (`Error` has two under `lib: ["es2022"]`). The typed file needs one overload line for each constructor of the base class and a tuple cast on `arguments`. That is the `test.todo` in the test file.
