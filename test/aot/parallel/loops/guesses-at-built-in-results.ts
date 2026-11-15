// A copied callback that guesses at what JSON.parse has just given: objects of the guessed shape and of others, values that are no objects, texts that do not parse.
// STATISTIC: SpeculationsCallingOnce >= 1
// The replacer is handed objects of the shape, so one of them may come back.
const TEXTS = [0, 1, 2, 3].map(k => JSON.stringify({ id: k, name: "name" + k, tags: ["a", "b"], ok: true }, (key, value) => value));
const OTHERS = ['{"name":"n","id":7,"tags":[],"ok":false}', '{"id":"8","name":[1,2]}', '{"id":1.5,"name":"x","more":1}', '[1,2,3]'];
const BROKEN = ['{"id":3,"name":"p"}', "null", "{", ""];
function inLoop(texts: string[], turn: number, from: string[]): number {
  let sum = 0;
  for (let j = 0; j < texts.length; j++) {
    const i = j + (turn % 64);
    const o = JSON.parse(from[i & 3]!);
    const r = o.id + o.name.length;
    sum = (sum * 3 + r) % 1000003;
  }
  return sum;
}
function inCallback(texts: string[], turn: number): number {
  let sum = 0;
  texts.forEach((s, j) => {
    const i = j + (turn % 64);
    let r = 0;
    const o = JSON.parse(TEXTS[i & 3]!);
    r = o.id + o.name.length;
    sum = (sum * 3 + r) % 1000003;
  });
  return sum;
}
function inCallbackOfOthers(texts: string[], turn: number): any {
  let sum: any = 0;
  texts.forEach((s, j) => {
    const i = j + (turn % 64);
    let r: any = 0;
    const o = JSON.parse(OTHERS[i & 3]!);
    r = o.id + (o.name ? o.name.length : 0);
    sum = (sum * 3 + String(r).length) % 1000003;
  });
  return sum;
}
let calls = 0;
function inCallbackThatCounts(texts: string[], turn: number): number {
  let sum = 0;
  texts.forEach((s, j) => {
    const i = j + (turn % 64);
    const o = JSON.parse(TEXTS[i & 3]!, (key, value) => {
      calls++;
      return value;
    });
    sum = (sum * 3 + o.id + o.name.length) % 1000003;
  });
  return sum;
}
const texts = ["alpha", "beta", "gamma", "delta", "eps", "zeta", "eta", "theta"];
let total = 0;
for (let t = 0; t < 50; t++) total = (total + inLoop(texts, t, TEXTS)) % 1000003;
console.log(total);
for (let t = 0; t < 50; t++) total = (total + inCallback(texts, t)) % 1000003;
console.log(total);
for (let t = 0; t < 50; t++) total = (total + inCallbackOfOthers(texts, t)) % 1000003;
console.log(total);
for (let t = 0; t < 50; t++) total = (total + inCallbackThatCounts(texts, t)) % 1000003;
console.log(total, calls);
for (const list of [OTHERS, BROKEN]) {
  for (let t = 0; t < 4; t++) {
    try {
      console.log(inLoop(texts.slice(0, t), t, list));
    } catch (error: any) {
      console.log(error.name);
    }
  }
}
