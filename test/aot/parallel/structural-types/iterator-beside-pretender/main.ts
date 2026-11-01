// Flags: --aot-check=verify-each-pass
// Two modules with iterators of their own. Beside the second, the first closes its iterator through calls that nobody has resolved yet: what return() answers is an object that is never built,
// and the test that it is one goes with it.
await import("./countdown.ts");
await import("./pretender.ts");
export {};
