// `switch` and `===` chains on a parameter of type `number`, with integers, fractions, -0 and NaN.
function pick(k: number): number { switch (k) { case 0: return 10; case 1: return 21; case 2: return 32; case 3: return 43; case 4: return 54; case 5: return 65; default: return 0 } }
function sparse(k: number): string { switch (k) { case -1: return "minus one"; case 0: return "zero"; case 1000: return "thousand"; case 2147483648: return "2^31"; case -2147483649: return "below"; case 9007199254740992: return "2^53"; default: return "none" } }
function chain(k: number): string { return k === 7 ? "seven" : k === 0 ? "zero" : k !== 3 ? (k === 2.5 ? "fraction" : "other") : "three" }
function few(k: number): string { return k === 1 ? "one" : k === 2 ? "two" : "many" }
const ks: number[] = ["0", "-0", "1", "2", "3", "4", "5", "6", "7", "-1", "2.5", "0.5", "4.000000001", "1000", "2147483648", "-2147483649", "9007199254740992", "9007199254740993", "1e300", "NaN", "Infinity", "-Infinity", "5e-324"].map(Number)
console.log(ks.map(pick).join())
console.log(ks.map(sparse).join())
console.log(ks.map(chain).join())
console.log(ks.map(few).join())
let seen = ""
for (let x = Number("-1"); x < 4; x += 0.5) { switch (x) { case 0: seen += "a"; break; case 1: seen += "b"; break; case 2: seen += "c"; break; case 3: seen += "d"; break; default: seen += "." } }
console.log(seen)
const loose: any = pick
console.log(loose(4), loose(4.5), loose(-0), loose(NaN), loose(5))
