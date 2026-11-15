// RUN: link
// CHECK: module {{*}}imports/two-functions.ts"
// CHECK: function {{*}}name="used"

// RUN(ABSENT): link
// ABSENT-NOT: two-functions.ts"{{*}}exports=

// An import by a name is bound to the variable and asks nothing of the object of the module. Nothing looks at that object here, so it
// shows no name, and an export that nothing is bound to is a variable like any other.
import { used } from "./imports/two-functions";

console.log(used());
