// A call to an overloaded function reports the overload it resolved to.
function o(a: number): number;
function o(a: string): string;
function o(a: any) { return a; }
o("x");
