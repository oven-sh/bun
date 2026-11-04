const hiddenName: string = (0, eval)("'zzLaid' + 'ByDescriptor'");
class Rec { b = "y"; [hiddenName] = 42; }
function make(): any { return new Rec(); }
function find(o: any): any { const all = Object.values(o); return all[all.length - 1]; }
let got: any; for (let i = 0; i < 300; i++) got = find(make());
console.log(typeof got, typeof got === "number", got === 42, typeof got === "object" && got !== null ? got.deep : "-", typeof got === "function" ? got("a") : "-");
