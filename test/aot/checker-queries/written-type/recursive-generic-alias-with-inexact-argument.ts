// A generic alias names itself with a `.d.ts` alias as the argument. The written type of that member is `unknown`, not the alias with the argument of the outer reference.
/// <reference path="./helper.d.ts" />
type Labeled<T> = { value: T; label: Labeled<Id> | null };
let a: Labeled<number>;
export {};
