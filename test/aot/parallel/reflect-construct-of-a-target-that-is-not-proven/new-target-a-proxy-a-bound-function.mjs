const log = [];
class A { constructor(x) { this.x = x; log.push(new.target === A ? "A" : new.target.name || typeof new.target); } }
function F(x) { this.x = x; log.push(new.target === F ? "F" : String(new.target)); }
const proxy = new Proxy(A, { construct(t, args, nt) { log.push("trap" + args.length + (nt === proxy)); return Reflect.construct(t, args, nt); } });
const all = JSON.parse("[0,1,2,3]").map((n) => [A, F, proxy, A.bind(null, 9)][n]);
let s = "";
for (let i = 0; i < all.length * 2; i++) s += Reflect.construct(all[i % 4], [i]).x;
console.log(s, log.join());
