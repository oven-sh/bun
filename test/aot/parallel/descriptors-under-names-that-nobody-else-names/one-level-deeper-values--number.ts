type Rec = { b: string };
type Holder = { inner: Rec };
function make(): Holder { const made: Rec = { b: "y" }; Object.defineProperty(made, "zzLaidByDescriptor", { value: 42, enumerable: true }); return { inner: made }; }
function find(h: Holder): any { return Object.values(h.inner)[1]; }
let got: any; for (let i = 0; i < 300; i++) got = find(make());
console.log(typeof got, typeof got === "number", got === 42, typeof got === "object" && got !== null ? got.deep : "-", typeof got === "function" ? got("a") : "-");
