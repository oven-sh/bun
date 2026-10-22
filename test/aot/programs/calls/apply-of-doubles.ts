// `f.apply(t, list)` and `f(...list)` where the array holds unboxed doubles.
declare const console: any;
const show: any = function (this: any, ...a: any[]) { return String(this) + "/" + a.length + ":" + a.map(v => Object.is(v, -0) ? "-0" : String(v)).join(); };
const fixed: any = function (a: any, b: any, c: any) { return [a, b, c].map(v => typeof v + " " + (Object.is(v, -0) ? "-0" : String(v))).join(); };
const parse = (text: string): any => JSON.parse(text);
const lists: any[] = [parse("[]"), parse("[1.5]"), parse("[1.5,2.5]"), parse("[1.5,2.5,3.5,4.5]"), parse("[1.5,2.5,3.5,4.5,5.5]"), parse("[0.5,1.5,2.5,3.5,4.5,5.5,6.5,7.5]"), parse("[0.5,1.5,2.5,3.5,4.5,5.5,6.5,7.5,8.5]"),
  parse("[-0.0,1.5]"), parse("[1e308,1.5,-1e308]"), parse("[1.0,2.5]"), parse("[4294967296.0,0.1]"), [1.5, 2.5].map(x => x * 2), Array.from({ length: 3 }, (_, i) => i + 0.25), new Array(3).fill(0.75)];
{ const holey = parse("[1.5,2.5,3.5]"); delete holey[1]; lists.push(holey); }
{ const grown = parse("[1.5]"); grown[3] = 2.5; lists.push(grown); }
{ const shrunk = parse("[1.5,2.5,3.5]"); shrunk.length = 1; lists.push(shrunk); }
{ const withNaN = parse("[1.5,2.5]"); withNaN[0] = NaN; lists.push(withNaN); }
{ const infinite = parse("[1.5,2.5]"); infinite[1] = Infinity; infinite[0] = -Infinity; lists.push(infinite); }
{ const mixed = parse("[1.5,2.5]"); mixed[1] = "s"; lists.push(mixed); }
{ const named = parse("[1.5,2.5]"); named.extra = 1; lists.push(named); }
{ const frozen = Object.freeze(parse("[1.5,2.5]")); lists.push(frozen); }
{ class Sub extends Array {} const sub: any = Sub.from([1.5, 2.5]); lists.push(sub); }
{ const reproto = parse("[1.5,,2.5]".replace(",,", ",0.5,")); delete reproto[1]; Object.setPrototypeOf(reproto, { 1: "inherited", __proto__: Array.prototype }); lists.push(reproto); }
const long = (): any => parse("[0.5,1.5,2.5,3.5,4.5,5.5,6.5,7.5,8.5,9.5]");
{ const edges = long(); edges[0] = -0; edges[4] = Infinity; edges[5] = -Infinity; edges[6] = 5e-324; edges[8] = -1.7976931348623157e308; edges[9] = -0; lists.push(edges); }
for (const at of [0, 4, 9]) { const withNaN = long(); withNaN[at] = NaN; lists.push(withNaN); }
for (const at of [0, 4, 9]) { const holey = long(); delete holey[at]; lists.push(holey); }
{ const mixed = long(); mixed[9] = "s"; lists.push(mixed); }
{ const named = long(); named.extra = 1; lists.push(named); }
for (let round = 0; round < 2; round++) {
  for (const list of lists) console.log(show.apply("T", list), "|", show(...list), "|", fixed.apply(null, list), "|", fixed(...list), "|", Math.max(...list), Math.min.apply(null, list), "|", Reflect.apply(show, "R", list));
}
export {};
