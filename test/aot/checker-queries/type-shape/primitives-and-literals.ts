// Primitive, literal and function types have their own shapes; `void` says nothing at run time.
let v1: any;
let v2: unknown;
let v3: never;
let v4: undefined;
let v5: null;
let v6: boolean;
let v7: true;
let v8: number;
let v9: 1.5;
let v10: bigint;
let v11: -12n;
let v12: string;
let v13: "a";
let v14: `a${string}b`;
let v15: symbol;
let v16: object;
let v17: Uppercase<string>;
let v18: () => void;
function f(): void {}
declare const s: unique symbol;
let v19: Function;
export {};
