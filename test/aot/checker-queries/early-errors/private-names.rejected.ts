// A private name in the heritage clause of the only class that declares it. TypeScript finds the declaration, ECMAScript does not. Checked or not.
declare const o: any; class C extends (o.#a) { #a = 1; } export {};
declare const o: any; class C extends (#a in o ? Object : Array) { #a = 1; } export {};
declare const o: any; class C extends class { m() { return o.#a; } } { #a = 1; } export {};
class C extends (o.#a) { #a }
⏎// @ts-nocheck⏎class C extends (o.#a) { #a; } export {};
⏎// @ts-nocheck⏎class C extends (#a in o ? Object : Array) { #a; } export {};
