// A parameter whose type does not resolve gives up alone: the other parameter and the result keep their types.
function f(a: Missing, b: number): string { return ""; }
f(0, 1);
