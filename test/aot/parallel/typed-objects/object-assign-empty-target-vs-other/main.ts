// What `Object.assign({}, record, { .. })` returns stands in an array literal beside a spread copy and a record that holds a closure.
import * as base from "./base";
import { remembered, type Rec } from "./base";
function counter(a: number): Rec { const made: Rec = { a, b: 1, n: { v: 2 }, bump: () => { made.a++; } }; return made; }
const other: Rec = remembered(7);
const copy = { ...other };
const counted = counter(3);
counted.bump?.();
function show(it: unknown): unknown { return it; }
console.log(JSON.stringify([base.D3_0, copy, counted].map(show)));
