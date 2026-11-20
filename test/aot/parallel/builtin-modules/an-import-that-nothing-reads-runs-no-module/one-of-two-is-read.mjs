// Two modules are imported and one is read: it runs where its name is first read, and the other one does not run.
// COUNT: operation:operationAOTRequireModule = 1
import { escape, stringify } from "node:querystring";
import vm, { runInNewContext } from "node:vm";
function neverCalled() {
  return [vm.createContext, runInNewContext];
}
console.log(stringify({ a: escape("b c"), d: [1, 2] }), typeof neverCalled);
