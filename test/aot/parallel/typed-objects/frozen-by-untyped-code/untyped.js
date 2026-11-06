export function frozen(value) {
  return Object.freeze(value);
}
export function sealed(value) {
  return Object.seal(value);
}
export function closed(value) {
  Reflect.preventExtensions(value);
  return value;
}
export function same(value) {
  return value;
}
export function store(object, name, value) {
  object[name] = value;
  return object[name];
}
export function storeX(object, value) {
  object.x = value;
  return object.x;
}
