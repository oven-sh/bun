// A mapped type over a type of the program has the trust of that type.
interface Mine { a: number; b: string }
let v1: Partial<Mine>;
let v2: Readonly<Mine>;
let v3: Pick<Mine, "a">;
export {};
