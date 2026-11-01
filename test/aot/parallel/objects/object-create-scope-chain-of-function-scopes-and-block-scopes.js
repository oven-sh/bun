// A scope chain: one function makes function scopes and one makes block scopes, each below its parent. Then the scopes get their variables.
function functionScope(parent) {
  const scope = Object.create(parent);
  scope.isFunction = true;
  return scope;
}
function blockScope(parent) {
  const scope = Object.create(parent);
  scope.isFunction = false;
  return scope;
}
const globalScope = functionScope(null);
const body = blockScope(globalScope);
const inner = blockScope(body);
const fn = functionScope(inner);
globalScope.x = 1;
body.y = 2;
console.log(fn.x, fn.y, fn.isFunction, inner.isFunction, Object.keys(globalScope).join(), Object.keys(body).join());
