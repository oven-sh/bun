class A { constructor(...all) { this.n = all.length; this.t = all.map(String).join("-"); } }
const all = JSON.parse("[0]").map(() => A);
const out = [];
for (let i = 0; i < 3; i++) { const more = [i, i]; out.push(Reflect.construct(all[0], [i, , 2]).t, Reflect.construct(all[0], [...more, 5]).t, Reflect.construct(all[0], more).n, Reflect.construct(all[0], []).n, more.length); }
console.log(out.join());
