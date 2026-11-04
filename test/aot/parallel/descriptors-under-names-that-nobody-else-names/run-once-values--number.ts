type Rec = { b: string };
const made: Rec = { b: "y" };
Object.defineProperty(made, "zzLaidByDescriptor", { value: 42, enumerable: true });
const got: any = Object.values(made)[1];
console.log(typeof got, typeof got === "number", got === 42, typeof got === "object" && got !== null ? got.deep : "-", typeof got === "function" ? got("a") : "-");
