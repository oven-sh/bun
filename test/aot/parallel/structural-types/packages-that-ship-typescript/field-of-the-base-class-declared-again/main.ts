import { Base, Derived } from "ships-typescript";
const derived = new Derived(5);
const base: Base = derived;
console.log(derived.size, base.size + 1);
