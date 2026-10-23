// An intersection with a type parameter is a type variable, and the other parts are its constraint.
function f<T>(x: T & { a: number }, y: T & string, z: T & { a: number } & { b: string }) {}
function g<T extends { b: string }>(x: T & { a: number }) {}
export {};
