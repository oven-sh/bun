// RUN(ONCE): link
// ONCE: module [[leaf]] path="{{*}}/imports/typescript-output/leaf.js"
// ONCE: function {{*}}module=[[leaf]] kind=CommonJsModule
// ONCE-NOT: PutModuleVariable
// ONCE: [[seven]] = Integer integer=7
// ONCE-NEXT: PutModuleVariable [[seven]] variable=
// ONCE-NEXT: [[add]] = GetModuleVariable
// ONCE-NEXT: PutModuleVariable [[add]]
// ONCE-NEXT: PutModuleVariable
// ONCE-NOT: PutModuleVariable
// ONCE: Return

// RUN(BEHIND): link
// BEHIND: module [[behind]] path="{{*}}/imports/typescript-output/behind-a-call.js"
// BEHIND: function {{*}}module=[[behind]] kind=CommonJsModule
// BEHIND: PutModuleVariable {{*}}variable=[[late]]
// BEHIND: PutModuleVariable {{*}}variable=[[late]]

// RUN(AGAIN): link
// AGAIN: module [[again]] path="{{*}}/imports/typescript-output/stored-again.js"
// AGAIN: function {{*}}module=[[again]] kind=CommonJsModule
// AGAIN: [[one]] = Integer integer=1
// AGAIN-NEXT: PutModuleVariable [[one]] variable=[[name]]
// AGAIN: PutModuleVariable {{*}}variable=[[name]]

// TypeScript stores `void 0` under every name that a file exports, in front of everything else. The variable of a name is born undefined and nothing has run by then, so that store stores nothing:
// each name of leaf.js is stored once, and whether a read comes behind the store is asked of the store that counts.
// Behind a call somebody may have stored under the name. A later store of undefined takes a value away.
const leaf_1 = require("./imports/typescript-output/leaf.js");
const behind_1 = require("./imports/typescript-output/behind-a-call.js");
const again_1 = require("./imports/typescript-output/stored-again.js");
console.log((0, leaf_1.scale)(2) + (0, leaf_1.add)(1, leaf_1.LIMIT), behind_1.late, again_1.again);
