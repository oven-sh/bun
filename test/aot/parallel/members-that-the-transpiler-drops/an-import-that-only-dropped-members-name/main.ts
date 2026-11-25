// An import that nothing uses is taken out of a TypeScript file, and its module is not loaded for it.
import { dec, name } from "./the-module-of-decorators";

abstract class C {
    // @ts-ignore
    @dec(1) abstract accessor first: number;
    // @ts-ignore
    @dec(2) abstract second(): void;
    // @ts-ignore
    @dec(3) third(value: number): void;
    third(value: unknown) { return value; }
    // @ts-ignore
    abstract fourth(@dec(4) value: number): void;
    // @ts-ignore
    abstract accessor [name]: number;
}

console.log(Object.getOwnPropertyNames(C.prototype).join());
