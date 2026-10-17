// `(other as any) = ..` replaces a function declaration for its callers.
declare const console: { log(a: unknown): void };
function other(a: number) { return a; }
function through(a: number) { return other(a); }
(other as any) = () => 2;
console.log(through(1));
