// A TypeScript `namespace` that is used as a value is a real object: `this` in its functions, uses before its statement has run, nested and merged namespaces.
declare const console: any;
function line(name: string, f: () => unknown) { try { console.log(name, JSON.stringify(f())); } catch (e: any) { console.log(name, "THREW", e.constructor.name); } }
line("before the statement: a function", () => { Late.f(); return "ran"; });
line("before the statement: a variable", () => Late.v);
line("before the statement: nested", () => Late.Inner.g());
namespace Late { export function f() { return 1; } export const v = 2; export namespace Inner { export function g() { return 3; } } }
line("after the statement", () => [Late.f(), Late.v, Late.Inner.g()]);
namespace N { export function g(this: unknown) { return typeof this; } export function self(this: unknown) { return this === N; } export const arrow = () => 5; export let count = 0; export function bump() { return ++count; } }
line("this", () => N.g());
line("this is the namespace", () => N.self());
line("detached", () => { const g = N.g; return g(); });
line("by key", () => (N as any)["g"]());
line("an arrow", () => N.arrow());
line("an exported let", () => { N.bump(); N.count += 10; return [N.count, N.bump()]; });
namespace Outer { export namespace Inner { export function who(this: unknown) { return this === Inner; } export function outer(this: unknown) { return this === Outer; } } }
line("nested: this", () => [Outer.Inner.who(), Outer.Inner.outer()]);
namespace Merged { export function a(this: unknown) { return this === Merged; } }
namespace Merged { export function b(this: unknown) { return this === Merged; } export const both = () => [a.call(Merged), b.call(Merged)]; }
line("merged", () => [Merged.a(), Merged.b(), Merged.both()]);
function Fn() { return "called"; }
namespace Fn { export function member(this: unknown) { return this === Fn; } }
line("with a function", () => [Fn(), Fn.member()]);
class Cl { static s(this: unknown) { return this === Cl; } }
namespace Cl { export function member(this: unknown) { return this === Cl; } }
line("with a class", () => [Cl.s(), Cl.member()]);
namespace Unused { export function never() { return 1; } }
line("keys", () => [Object.keys(Late), Object.keys(N), Object.keys(Outer), Object.keys(Merged), Object.keys(Fn), Object.keys(Cl)]);
line("stored to from outside", () => { (N as any).g = function () { return "replaced"; }; return N.g(); });
