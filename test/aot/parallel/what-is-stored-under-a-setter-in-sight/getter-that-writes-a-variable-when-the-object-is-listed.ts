type Rec = { b: string };
let times = 0;
function make(): Rec { const made: Rec = { b: "y" }; Object.defineProperty(made, "zzCountsItsReads", { get() { times++; return 1; }, enumerable: true }); return made; }
function find(o: any): number { const before = times; Object.values(o); return times - before; }
let got = 0; for (let i = 0; i < 300; i++) got += find(make());
console.log(got, times);
