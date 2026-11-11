const unseen = (x: any): any => [x][JSON.parse("0")];
const say = (value: unknown): string => typeof value + ":" + String(value);
interface Wide { w0?: number; w1?: number; w2?: number; w3?: number; w4?: number; w5?: number; w6?: number; w7?: number; w8?: number; w9?: number; w10?: number; w11?: number; w12?: number; w13?: number; w14?: number; w15?: number; w16?: number; w17?: number; w18?: number; w19?: number; w20?: number; w21?: number; w22?: number; w23?: number; w24?: number; w25?: number; w26?: number; w27?: number; w28?: number; w29?: number; w30?: number; w31?: number; w32?: number; w33?: number; w34?: number; w35?: number; w36?: number; w37?: number; w38?: number; w39?: number; }
function makeWide(seed: number): Wide { return { w0: seed + 0, w1: seed + 1, w2: seed + 2, w3: seed + 3, w4: seed + 4, w5: seed + 5, w6: seed + 6, w7: seed + 7, w8: seed + 8, w9: seed + 9, w10: seed + 10, w11: seed + 11, w12: seed + 12, w13: seed + 13, w14: seed + 14, w15: seed + 15, w16: seed + 16, w17: seed + 17, w18: seed + 18, w19: seed + 19, w20: seed + 20, w21: seed + 21, w22: seed + 22, w23: seed + 23, w24: seed + 24, w25: seed + 25, w26: seed + 26, w27: seed + 27, w28: seed + 28, w29: seed + 29, w30: seed + 30, w31: seed + 31, w32: seed + 32, w33: seed + 33, w34: seed + 34, w35: seed + 35, w36: seed + 36, w37: seed + 37, w38: seed + 38, w39: seed + 39 }; }
function run(x: Wide): string {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  work = (work + ((x.w1 as number) | 0) + ((x.w2 as number) | 0)) | 0;
  return say(x.w0) + say(x.w3) + say(x.w20) + say(x.w21) + say(x.w38) + say(x.w39) + work + Object.keys(x).length;
}
const runs: ((...all: any[]) => string)[] = [run, unseen(run)];
unseen(makeWide(0));
for (let i = 0; i < 6; i++) unseen(JSON.parse(unseen('{"w0":0,"w1":1,"w2":2,"w3":3,"w4":4,"w5":5,"w6":6,"w7":7,"w8":8,"w9":9,"w10":10,"w11":11,"w12":12,"w13":13,"w14":14,"w15":15,"w16":16,"w17":17,"w18":18,"w19":19,"w20":20,"w21":21,"w22":22,"w23":23,"w24":24,"w25":25,"w26":26,"w27":27,"w28":28,"w29":29,"w30":30,"w31":31,"w32":32,"w33":33,"w34":34,"w35":35,"w36":36,"w37":37,"w38":38}')) as Wide);
let last = "";
for (let i = 0; i < 300; i++) last = runs[JSON.parse("0")](makeWide(i));
console.log("warm", last);
console.log("odd", runs[JSON.parse("0")](JSON.parse(unseen('{"w0":0,"w1":1,"w2":2,"w3":3,"w4":4,"w5":5,"w6":6,"w7":7,"w8":8,"w9":9,"w10":10,"w11":11,"w12":12,"w13":13,"w14":14,"w15":15,"w16":16,"w17":17,"w18":18,"w19":19,"w20":20,"w21":21,"w22":22,"w23":23,"w24":24,"w25":25,"w26":26,"w27":27,"w28":28,"w29":29,"w30":30,"w31":31,"w32":32,"w33":33,"w34":34,"w35":35,"w36":36,"w37":37,"w38":38}')) as Wide));
console.log("again", runs[JSON.parse("0")](makeWide(7)));
export {};
