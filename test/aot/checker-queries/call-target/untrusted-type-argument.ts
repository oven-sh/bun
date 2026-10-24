// A type argument that names a `.d.ts` alias does not instantiate the written result: its written form, `unknown`, would take the other branch of a conditional type.
/// <reference path="./untrusted-type-argument.d.ts" />
interface Name { name: string }
interface Count { count: number }
declare function pick<T>(): T extends string ? Name : Count;
pick<Port>();
pick<string>();
export {};
