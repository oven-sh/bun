export const InNamespace = { a: 1, b: 2 };
export const AlsoInNamespace = { a: 10, b: 20 };
export function readInNamespace() {
  return InNamespace.a + AlsoInNamespace.a;
}
