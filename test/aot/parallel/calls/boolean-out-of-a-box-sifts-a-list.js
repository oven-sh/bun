// Boolean is found under a name that the build has not seen and handed to filter, some, every, find and map, over values out of a box
const hidden = JSON.parse('{"truth":"Boolean","text":"String"}');
const box = JSON.parse('[0,1,"","a",null,false,true,0.5,-0.0,1e400,[],{},"0",2147483648]');
function sifted(list, test) {
  return list.filter(test).map(value => typeof value + " " + JSON.stringify(value)).join("|");
}
function deed(name) {
  return globalThis[name];
}
const truth = deed(hidden.truth);
console.log(sifted(box, truth));
console.log(sifted([undefined, NaN, -0, 0n, 1n, Symbol.iterator, () => 0].map(value => typeof value === "bigint" || typeof value === "symbol" || typeof value === "function" ? truth(value) : value), truth));
console.log(String(box.some(truth)) + " " + String(box.every(truth)) + " " + String(box.find(truth)) + " " + String(box.findIndex(truth)));
console.log(box.map(truth).join());
let kept = 0;
for (let i = 0; i < 300; i++) kept += box.filter(truth).length;
console.log(String(kept));
console.log(box.map(deed(hidden.text)).join("|"));
console.log(String(truth()) + " " + String(truth.call(1, 0)) + " " + typeof new truth(0));
