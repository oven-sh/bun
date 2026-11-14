export const next = () => counter + 1;
export const kind = () => typeof counter;
export const size = () => registry.length;
export function store() {
  counter = "stored by a strict module";
  return counter;
}
export function storeUndeclared() {
  neverDeclaredAnywhere = 1;
  return typeof neverDeclaredAnywhere;
}
