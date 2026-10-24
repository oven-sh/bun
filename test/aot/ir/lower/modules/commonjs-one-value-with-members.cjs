// RUN(RECORDS): link
// RECORDS: module {{*}}/imports/one-value/create.cjs"{{*}}kind=CommonJs{{*}}exportsVariable=g

// RUN(NOWHERE): link
// NOWHERE-NOT: RequireModule

// RUN(MEMBERS): link
// MEMBERS: module [[file]] path="{{*}}/imports/one-value/create.cjs"{{*}}exportsVariable=[[exports]]
// MEMBERS: function {{*}}module=[[file]] kind=CommonJsModule
// MEMBERS: PutModuleVariable {{*}}variable=[[exports]]
// MEMBERS-NEXT: [[first]] = GetModuleVariable variable=[[exports]]
// MEMBERS: PropSet [[first]], {{*}}key="version"
// MEMBERS-NEXT: [[second]] = GetModuleVariable variable=[[exports]]
// MEMBERS: PropSet [[second]], {{*}}key="twice"
// MEMBERS: EvaluateModule module=[[file]] {{*}}[isBare]
// MEMBERS-NEXT: [[read]] = GetModuleVariable variable=[[exports]]
// MEMBERS-NEXT: [[create]] = Convert [[read]]
// MEMBERS: = PropGet [[create]] key="version"
// MEMBERS: = PropGet [[create]] key="twice"

// `module.exports = create`, stored once, in order, ahead of every member: the one variable of the module holds the function, and a require reads the variable. The members stay properties of the function: whoever holds it reaches them by another road.
const create = require("./imports/one-value/create.cjs");
console.log(create(), create.version, create.twice(2));
