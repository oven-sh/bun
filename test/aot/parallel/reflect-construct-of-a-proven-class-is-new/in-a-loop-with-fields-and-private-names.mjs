class P { #k = 3; y = 2; static made = 0; constructor(x) { this.x = x; P.made++; } sum() { return this.x + this.y + this.#k; } }
let s = 0; for (let i = 0; i < Number("50"); i++) s += Reflect.construct(P, [i]).sum();
console.log(s, P.made);
