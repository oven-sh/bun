// The same import as where only dropped members name it, and one member that stays names it: the module is loaded, and `dec` is called once.
import { dec, name } from "./the-module-of-decorators";

abstract class C {
    // @ts-ignore
    @dec(1) abstract accessor first: number;
    // @ts-ignore
    @dec(2) abstract second(): void;
    @dec(3) third(value: unknown) { return value; }
    // @ts-ignore
    abstract fourth(@dec(4) value: number): void;
    // @ts-ignore
    abstract accessor [name]: number;
}

console.log(Object.getOwnPropertyNames(C.prototype).join());
