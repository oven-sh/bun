import * as b from "bun-builtins-table";

// The host of the programs that WebKit's own build links: jsc, testaot, testFFI. It has no natives and no front end.
// The compiler does not work without its helpers: compiler-helpers.builtins.ts beside this file is Bun's src/codegen/builtins/host/compiler-helpers.builtins.ts.
export default b.declarations(
  b.namespace("%UnfilledHostRole%", {}),
  b.class("%UnfilledHostRoleClass%", { hasConstructor: false }),
  b.unfilledHostRoles("%UnfilledHostRole%", "UnfilledHostRoleClass"),
  b.namespace("console", {}),
  b.namespace("%UndeclaredNativeCode%", {}),
  // models/Objects.ts has a model of it.
  b.namespace("%PrivateGlobals%", {
    toClass: {
      args: { target: b.any, name: b.any.optional, base: b.any.optional },
      returns: b.undefined,
      capability: "js",
      throws: true,
      uses: {
        target: [b.everything, b.prototypeSetTo("base"), b.definesName(["prototype", "name"], b.any)],
        name: [b.everything],
        base: [b.everything],
      },
      model: b.functionIn("models/Objects", "toClass"),
      implementation: b.hostCall,
    },
  }),
  b.frontEndFunctions("prelude/array-search", "includes", "indexOf"),
  b.frontEndFunctions("prelude/array-sort", "sort", "toSorted"),
  b.frontEndFunctions("prelude/array-traversal", "traverseArray"),
  b.frontEndFunctions(
    "prelude/decorators",
    "applyAccessorDecorators",
    "applyClassDecorators",
    "applyFieldDecorators",
    "applyMethodDecorators",
    "applyPrivateAccessorDecorators",
    "applyPrivateFieldDecorators",
    "applyPrivateMethodDecorators",
    "createDecoratorMetadata",
    "createElement",
    "createPrivateStorage",
    "decorateClass",
    "decorateMethod",
    "decorateParameter",
    "decorateProperty",
    "defineMetadata",
    "runInitializers",
    "runValueInitializers",
    "setDecoratorMetadata",
  ),
  b.frontEndFunctions(
    "prelude/written-lists",
    "arrayFromLength",
    "arrayOfUndefined",
    "checkedArrayLength",
    "filledArray",
    "mappedFilledArray",
  ),
);
