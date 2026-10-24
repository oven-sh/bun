export function foo(a: object, props: PropertyDescriptorMap) {
  Object.defineProperties(a, props);
}
