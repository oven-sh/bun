// A type parameter in a union stays a member of it.
function f<T>(x: T | string, y: T | undefined, z: T | T[]) {}
function g<T extends number>(x: T | string) {}
export {};
