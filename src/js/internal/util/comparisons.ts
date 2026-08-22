// Deep-strict-equality helpers shared by node:assert and node:util.
"use strict";

// Native comparator: node semantics including [[Prototype]] identity.
// Third arg truthy = skipPrototype (Assert class option, node's
// kStrictWithoutPrototypes mode). node v26.3.0 exposes fn.length === 3.
const isDeepStrictEqual = $newCppFunction("NodeUtilTypesModule.cpp", "jsFunctionIsDeepStrictEqual", 3);

// node's loose mode, behind assert.deepEqual / assert.notDeepEqual. Not the
// same relation as Bun.deepEquals(a, b, false), which expect() uses.
const isDeepEqual = $newCppFunction("NodeUtilTypesModule.cpp", "jsFunctionIsDeepEqual", 2);

export default { isDeepStrictEqual, isDeepEqual };
