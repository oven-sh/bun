// Booleans, and a refusal of what is no object.
import { types } from "node:util";
import vm from "node:vm";
import * as space from "node:path";
function asked(value) { return vm.isContext(value); }
console.log(asked({}), typeof asked({}), asked([]), asked(() => {}));
for (const odd of [undefined, null, 1, "a", Symbol.iterator]) try { console.log(asked(odd)); } catch (error) { console.log(error.code); }
function named(value) { return types.isModuleNamespaceObject(value); }
console.log(named(space), named({}), named(undefined), typeof named(1), named());
class Holder { first = vm.isContext({}); second = types.isModuleNamespaceObject(space); }
console.log(new Holder().first, new Holder().second);
