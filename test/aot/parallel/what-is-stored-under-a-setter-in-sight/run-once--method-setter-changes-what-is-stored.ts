type Rec = { n: number };
const holder: any = { b: "y" };
Object.defineProperty(holder, "taker", { set(v: any) { v.n = "text"; } });
const rec: Rec = { n: 1 };
holder.taker = rec;
const got: any = rec.n;
console.log(typeof got, typeof got === "number", got === "text");
