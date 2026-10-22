// RUN(RECORDS): link
// RECORDS: module {{*}}/imports/chain/cycle-a.cjs"{{*}}requests=[{target=m{{*}}kind=Require

// RUN(BACK): link
// BACK: module {{*}}/imports/chain/cycle-b.cjs"{{*}}requests=[{target=m{{*}}kind=Require

// RUN(SITES): link
// SITES-COUNT-3: EvaluateModule module=m{{*}} [isBare]
// SITES-NOT: EvaluateModule

// RUN(NOWHERE): link
// NOWHERE-NOT: RequireModule

// RUN(FILES): link
// FILES: module [[b]] path="{{*}}/imports/chain/cycle-b.cjs"
// FILES: module [[a]] path="{{*}}/imports/chain/cycle-a.cjs"
// FILES: module [[entry]] path="{{*}}/commonjs-cycle"
// FILES: function {{*}}module=[[b]] kind=CommonJsModule
// FILES-NOT: PropSet
// FILES-NOT: = NewObject
// FILES: function {{*}}module=[[a]] kind=CommonJsModule
// FILES-NOT: PropSet
// FILES-NOT: = NewObject
// FILES: function {{*}}module=[[entry]] kind=CommonJsModule

// Two files that require each other at the top and read each other by names stay modules without an exports object. A name that is not stored yet reads undefined: its variable starts out so.
const a = require("./imports/chain/cycle-a.cjs");
console.log(a.saw);
