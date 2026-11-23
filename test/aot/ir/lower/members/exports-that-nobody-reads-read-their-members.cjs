// The build has no use for what these files store under names that nobody reads, and makes none of their calls of Object.defineProperty.
// `bun run` evaluates every value and makes every call, and Object lists a member from its first read on: the reads stay.

// The value of a name that nobody reads.
// RUN(VALUE): link
// VALUE: module [[file]] path="{{*}}/value.cjs"
// VALUE: function {{*}}module=[[file]] kind=CommonJsModule
// VALUE-NOT: function f
// VALUE: = Builtin builtin=ObjectKeys

// The definition of a name that nobody reads is left out as a part.
// RUN(UNREAD): link
// UNREAD: module [[file]] path="{{*}}/unread.cjs"
// UNREAD: function {{*}}module=[[file]] kind=CommonJsModule
// UNREAD-NOT: function f
// UNREAD: = Builtin builtin=ObjectDefineProperty
// UNREAD-NOT: = Call
// UNREAD: Return

// The marker, which the graph of modules takes, and the definition of a name that is a variable.
// RUN(READ): link
// READ: module [[file]] path="{{*}}/read.cjs"
// READ: function {{*}}module=[[file]] kind=CommonJsModule
// READ-NOT: function f
// READ-COUNT-2: = Builtin builtin=ObjectDefineProperty
// READ-NOT: = Call
// READ: PutModuleVariable

// `bun run` drops a marked call with its callee.
// RUN(MARKED): link
// MARKED: module [[file]] path="{{*}}/marked.cjs"
// MARKED: function {{*}}module=[[file]] kind=CommonJsModule
// MARKED-NOT: = Builtin builtin=ObjectFreeze
// MARKED: Return

// FILE: main.cjs
const { one } = require("./value.cjs");
const { b } = require("./unread.cjs");
const { c } = require("./read.cjs");
const { d } = require("./marked.cjs");
console.log(one, b, c, d);

// FILE: value.cjs
module.exports = { keys: Object.keys, one: 1 };

// FILE: unread.cjs
Object.defineProperty(exports, "a", { value: 1 });
exports.b = 2;

// FILE: read.cjs
Object.defineProperty(exports, "__esModule", { value: true });
Object.defineProperty(exports, "c", { value: 3 });

// FILE: marked.cjs
/* @__PURE__ */ Object.freeze({});
exports.d = 4;
