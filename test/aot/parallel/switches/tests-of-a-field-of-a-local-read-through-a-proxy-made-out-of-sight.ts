// a proxy that nobody sees being made stands in the place of the holder: each arm of the chain asks its trap anew
type Item = { kind: number; text: string };
function tell(item: Item) {
  if (item.kind === 1) return "one " + item.text;
  else if (item.kind === 4) return "four " + item.text;
  else if (item.kind === 9) return "nine " + item.text;
  return "other " + item.text;
}
const hidden = JSON.parse('{"proxy":"Proxy"}');
const log: string[] = [];
function deed(target: Item): Item {
  return new (globalThis as any)[hidden.proxy](target, { get(held: any, key: string) { log.push(key); return held[key]; } });
}
console.log(tell({ kind: 1, text: "a" }), tell({ kind: 9, text: "b" }), tell({ kind: 2, text: "c" }));
let told = "";
for (let i = 0; i < 300; i++) told = tell({ kind: i % 10, text: "t" });
console.log(told);
console.log(tell(deed({ kind: 9, text: "behind" })), log.join());
log.length = 0;
console.log(tell(deed({ kind: 1, text: "behind" })), log.join());
log.length = 0;
console.log(tell(deed({ kind: 7, text: "behind" })), log.join());
