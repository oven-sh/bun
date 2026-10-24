// RUN(LEAF): link
// LEAF: module {{*}}/imports/chain/m0.js"{{*}}kind=CommonJs flags=[KeepsError]

// RUN(RECORDS): link
// RECORDS: module {{*}}/imports/chain/m1.js"{{*}}kind=CommonJs flags=[KeepsError]{{*}}requests=[{target=m{{*}}kind=Require completes=true}]

// RUN(BODY): link
// BODY: EvaluateModule module=m{{*}} [isBare]
// BODY: [[read]] = GetModuleVariable
// BODY-NEXT: [[c]] = Convert [[read]]
// BODY: = Add [[c]]
// BODY: PutModuleVariable
// BODY: = NewClosure function=
// BODY: PutModuleVariable

// RUN(NOWHERE): link
// NOWHERE-NOT: RequireModule
// NOWHERE-NOT: layout {{*}}key="c"
// NOWHERE-NOT: syntheticExports=

// RUN(FILES): link
// FILES: module [[leaf]] path="{{*}}/imports/chain/m0.js"
// FILES: module [[entry]] path="{{*}}/commonjs-requires-commonjs"
// FILES: function {{*}}module=[[leaf]] kind=CommonJsModule
// FILES-NOT: PropSet
// FILES-NOT: = NewObject
// FILES-NOT: = NewClass
// FILES-NOT: key="f"
// FILES: function {{*}}module=[[entry]] kind=CommonJsModule

// A CommonJS file whose exports are only read, stored and called by name has no exports object: a name that somebody reads is a variable of the module, which its body stores. A name that nobody reads gets no variable, and what only it needs is left out.
const a = require("./imports/chain/m1.js");
console.log(a.f(2));
