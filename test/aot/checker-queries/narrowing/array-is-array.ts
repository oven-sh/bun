// `Array.isArray` is a type guard that the library declares. It narrows like one that the program declares.
declare const x: string | number[];
if (Array.isArray(x)) {
  x;
} else {
  x;
}
