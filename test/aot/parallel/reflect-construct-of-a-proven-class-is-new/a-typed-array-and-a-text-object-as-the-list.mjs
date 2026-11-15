class P { constructor(...all) { this.t = all.join("-"); } }
console.log(Reflect.construct(P, new Uint8Array([4, 5, 6])).t, Reflect.construct(P, new String("xyz")).t, Reflect.construct(P, new Set([1])).t === "", Reflect.construct(P, { length: 2 }).t);
