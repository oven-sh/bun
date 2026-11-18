function apply(target, thisArgument, argumentsList) {
  "use strict";
  if (!@isCallable(target)) @throwTypeError("Reflect.apply requires the first argument be a function");
  if (!@isObject(argumentsList)) @throwTypeError("Reflect.apply requires the third argument be an object");
  return target.@apply(thisArgument, argumentsList);
}

function get(target, propertyKey /*, receiver */) {
  "use strict";
  if (!@isObject(target)) @throwTypeError("Reflect.get requires the first argument be an object");
  if (@argumentCount() < 3) return target[propertyKey];
  return @getByValWithThis(target, @argument(2), propertyKey);
}

function has(target, propertyKey) {
  "use strict";
  if (!@isObject(target)) @throwTypeError("Reflect.has requires the first argument be an object");
  return propertyKey in target;
}
