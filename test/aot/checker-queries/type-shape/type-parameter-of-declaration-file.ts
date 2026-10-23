// A type parameter has the trust of the file that declares it. The declarations of a merged interface share one type parameter, which is that of the first declaration.
/// <reference path="./type-parameter-of-declaration-file.d.ts" />
declare global { interface Host<T> { extra: T } }
interface Mine<T> { value: T }
interface Named<T extends string> { value: T }
export {};
