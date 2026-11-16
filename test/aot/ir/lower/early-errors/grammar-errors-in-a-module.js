// Errors that the language reports before a module runs, one a line.
// RUN: lower
// DIAGNOSTIC: TS2392 2
// DIAGNOSTIC: TS17013 1
// DIAGNOSTIC: TS1108 1
// DIAGNOSTIC: TS1114 1
// DIAGNOSTIC: TS1214 8
// DIAGNOSTIC: TS1213 1
// DIAGNOSTIC: TS1102 1
// DIAGNOSTIC: TS1262 3
// DIAGNOSTIC: TS1359 3

class TwoConstructors { constructor() {} constructor() {} }
new.target;
return;
again: { again: { console.log(1); } }
var let = 1;
var public = 1;
class static {}
const arrow = package => 1;
const shorthand = ({ public }) => {};
yield;
yield: 1;
for ({ yield } of [{}]);
var variable; delete ((variable));
class AwaitVariable { static { var { await } = {}; } }
class AwaitFunction { static { function await() {} } }
async function asyncFunction() { function await() {} }
for (let in {}) {}
