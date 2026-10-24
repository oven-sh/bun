// A member that several parts of an intersection declare is written only if it is written in every part: `{ brand: true } & string` is a string, so one part says nothing about the whole.
/// <reference path="./intersection-receiver.d.ts" />
interface A { id: { brand: true }; rows: { n: number }[]; own: number }
interface B { id: string; rows: string | { n: number } }
declare const both: A & B;
both.id;
both.rows;
both.own;
declare const half: A & Outside;
half.id;
half.rows;
half.own;
export {};
