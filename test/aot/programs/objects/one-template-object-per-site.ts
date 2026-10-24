// A tagged template passes the same strings array at every evaluation of one site, and different arrays at different sites.
declare const console: any;
const id = (s: TemplateStringsArray, ..._: unknown[]): TemplateStringsArray => s;
function typed(p: { x: number }): TemplateStringsArray { return id`a${p.x}b`; }
const letOut: any = typed;
const plain = () => JSON.parse('{"x":1}');
console.log("two bodies", typed({ x: 1 }) === typed({ x: 2 }), typed({ x: 1 }) === letOut(plain()), letOut(plain()) === letOut(plain()), letOut({ x: 3 }) === typed({ x: 3 }));
class Base {}
class Fields extends Base {
  f = id`field`;
  constructor(way: number) { if (way === 0) { super(); } else if (way === 1) { super(); } else { super(); } }
}
console.log("every super()", new Fields(0).f === new Fields(1).f, new Fields(1).f === new Fields(2).f, new Fields(0).f === new Fields(0).f);
function twoSites(): [TemplateStringsArray, TemplateStringsArray] { return [id`same`, id`same`]; }
const [p, q] = twoSites();
console.log("two sites, one text", p === q, p === twoSites()[0], q === twoSites()[1]);
function other(): TemplateStringsArray { return id`same`; }
console.log("another function", other() === p, other() === other());
const makers = [0, 1, 2].map(() => () => id`closure`);
console.log("closures of one site", makers[0]() === makers[1](), makers[1]() === makers[2]());
function* gen() { for (let i = 0; i < 3; i++) yield id`gen${i}`; }
const made = [...gen()];
console.log("a loop", made[0] === made[1], made[1] === made[2]);
class Static { static s = id`static`; static t = id`static`; m() { return id`method`; } }
console.log("static", Static.s === Static.t, new Static().m() === new Static().m());
console.log("frozen", Object.isFrozen(p), Object.isFrozen(p.raw), Array.isArray(p), p.length, p.raw.length);
function nested(p: { x: number }) { return [id`out${id`in${p.x}`}`, id`in${p.x}`]; }
const nestedOut: any = nested;
console.log("nested", nested({ x: 1 })[0] === nestedOut(plain())[0], nested({ x: 1 })[1] === nestedOut(plain())[1], nested({ x: 1 })[0] === nested({ x: 1 })[1]);
