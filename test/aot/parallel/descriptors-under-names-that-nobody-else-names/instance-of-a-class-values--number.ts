class Rec { b = "y"; constructor() { Object.defineProperty(this, "zzLaidByDescriptor", { value: 42, enumerable: true }); } }
function find(o: any): any { return Object.values(o)[1]; }
let got: any; for (let i = 0; i < 300; i++) got = find(new Rec());
console.log(typeof got, typeof got === "number", got === 42, typeof got === "object" && got !== null ? got.deep : "-", typeof got === "function" ? got("a") : "-");
