// An allocation lists a constant of the slot's type where a value is not proven to fit, and the value is stored behind it. Each written type, with a value that fits and values that do not.
type Kinds = { whole: number; text: string; flag: boolean; word: "on" | "off"; maybe: number | undefined; none: number | null; last: number };
function make(text: string): Kinds { const x: any = JSON.parse(text); return { whole: x.whole, text: x.text, flag: x.flag, word: x.word, maybe: x.maybe, none: x.none, last: x.last }; }
function show(o: Kinds) { return [o.whole, o.text, o.flag, o.word, o.maybe, o.none, o.last].map(v => typeof v + ":" + String(v)).join() + "|" + Object.keys(o).join() + "|" + JSON.stringify(o); }
const fits = '{"whole":5,"text":"a","flag":true,"word":"off","maybe":7,"none":null,"last":9}';
const others = ['{"whole":7.5,"text":"","flag":false,"word":"on","none":3,"last":-0.5}', '{"whole":2147483648,"text":5,"flag":0,"word":"other","maybe":"x","none":"y","last":{}}', '{"whole":"5","text":null,"flag":"true","word":1,"maybe":null,"none":[1],"last":null}', "{}"];
for (let turn = 0; turn < 3; turn++) { console.log(show(make(fits))); for (const text of others) console.log(show(make(text))); }
