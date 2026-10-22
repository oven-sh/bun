// A conditional alias decides by its argument. An argument that names a `.d.ts` alias is not exact, so the written type is `unknown`, not the branch the checker takes.
/// <reference path="./helper.d.ts" />
type ElementKind<T> = T extends string[] ? "text" : "other";
let a: ElementKind<Id[]>;
let b: ElementKind<string[]>;
export {};
