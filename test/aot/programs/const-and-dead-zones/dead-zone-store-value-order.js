// A store in the dead zone of its target: a binding that closures share is tested before the right-hand side runs, a binding of one function after it.
const calls = [];
function effect(name) {
  calls.push(name);
  return name;
}
function attempt(store) {
  try {
    store();
    return "stored";
  } catch (error) {
    return error.name;
  }
}
function report(title, outcome) {
  console.log(title, outcome, JSON.stringify(calls.splice(0)));
}

function storeModuleLevel() {
  moduleLevel = effect("module level");
}
report("module level, in a function, early:", attempt(storeModuleLevel));
try {
  moduleLevel = effect("module level, directly");
  report("module level, directly:", "stored");
} catch (error) {
  report("module level, directly:", error.name);
}
let moduleLevel = "initial";
report("module level, in a function, late:", attempt(storeModuleLevel));
console.log(moduleLevel);

try {
  unshared = effect("unshared module level");
  report("unshared module level:", "stored");
} catch (error) {
  report("unshared module level:", error.name);
}
let unshared = "initial";
console.log(unshared);

function storeClass() {
  Shared = effect("class");
}
report("class, early:", attempt(storeClass));
class Shared {}
report("class, late:", attempt(storeClass));
console.log(Shared);

function sharedInFunction() {
  const store = () => {
    shared = effect("closure");
  };
  report("closure, early:", attempt(store));
  try {
    shared = effect("declaring function");
    report("declaring function:", "stored");
  } catch (error) {
    report("declaring function:", error.name);
  }
  let shared = "initial";
  report("closure, late:", attempt(store));
  return shared;
}
console.log(sharedInFunction());

function unsharedInFunction() {
  try {
    local = effect("local");
    report("local:", "stored");
  } catch (error) {
    report("local:", error.name);
  }
  let local = "initial";
  return local;
}
console.log(unsharedInFunction());

function namedByTarget() {
  const read = () => named;
  try {
    named = function () {
      return effect("never called");
    };
  } catch (error) {
    report("function value:", error.name);
  }
  let named = "initial";
  return read();
}
console.log(namedByTarget());

function nestedStores() {
  const read = () => [outer, inner];
  try {
    outer = inner = effect("nested");
  } catch (error) {
    report("nested, outer in its dead zone:", error.name);
  }
  let outer = "outer";
  try {
    outer = inner = effect("nested");
  } catch (error) {
    report("nested, inner in its dead zone:", error.name);
  }
  let inner = "inner";
  return read();
}
console.log(JSON.stringify(nestedStores()));
