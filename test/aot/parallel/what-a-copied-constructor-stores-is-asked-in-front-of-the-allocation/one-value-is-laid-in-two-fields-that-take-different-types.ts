// One parameter goes into two fields whose written types differ: it is asked once, for what both take.
// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: what the allocation lists is held against what its slots take
interface Pair { wide: number | string | undefined; narrow: number; text: string | undefined; rest?: object; more?: object; }
function Pair(this: Pair, value: number, text: string) { this.wide = value; this.narrow = value; this.text = text; this.rest = undefined; this.more = undefined; }
const Maker: new (value: number, text: string) => Pair = Pair as any;
function make(value: any, text: any) { return new Maker(value, text); }
function fill(pair: Pair, value: object) { pair.rest = value; pair.more = value; }
const given: any[] = JSON.parse('[1, "one", 2.5, null, true, {"n": 1}, -7]'); given.push(undefined);
for (const value of given) for (const text of given) { const pair = make(value, text); console.log(Object.keys(pair).join(), typeof pair.wide, String(pair.wide), typeof pair.narrow, String(pair.narrow), typeof pair.text, String(pair.text), pair.rest, "more" in pair); }
const last = make(3, "three"); fill(last, given); console.log(Object.keys(last).join(), last.rest === given, last.more === given);
