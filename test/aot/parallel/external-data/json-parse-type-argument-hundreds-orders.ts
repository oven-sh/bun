// Types of 1 to 65 members are given their keys in hundreds of orders, each order again and again, two types with the same members in turn, with optional members left out and undeclared keys between: what remembers an order of declared keys is filled, turned over and emptied by collections.
const host: any = globalThis;
const collect: () => void = host.Bun ? () => host.Bun.gc(true) : host.gc;
type A1 = { m0: number };
type B1 = { m0: number };
type A2 = { m0: number; m1: string };
type B2 = { m0: number; m1: string };
type A3 = { m0: number; m1: string; m2: boolean };
type B3 = { m0: number; m1: string; m2: boolean };
type A4 = { m0: number; m1: string; m2: boolean; m3: number | null };
type B4 = { m0: number; m1: string; m2: boolean; m3: number | null };
type A7 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean };
type B7 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean };
type A8 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean; m7: number | null };
type B8 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean; m7: number | null };
type A9 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean; m7: number | null; m8: number };
type B9 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean; m7: number | null; m8: number };
type A11 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean; m7: number | null; m8: number; m9?: string; m10: boolean };
type B11 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean; m7: number | null; m8: number; m9?: string; m10: boolean };
type A12 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean; m7: number | null; m8: number; m9?: string; m10: boolean; m11: number | null };
type B12 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean; m7: number | null; m8: number; m9?: string; m10: boolean; m11: number | null };
type A13 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean; m7: number | null; m8: number; m9?: string; m10: boolean; m11: number | null; m12: number };
type B13 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean; m7: number | null; m8: number; m9?: string; m10: boolean; m11: number | null; m12: number };
type A14 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean; m7: number | null; m8: number; m9?: string; m10: boolean; m11: number | null; m12: number; m13: string };
type B14 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean; m7: number | null; m8: number; m9?: string; m10: boolean; m11: number | null; m12: number; m13: string };
type A15 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean; m7: number | null; m8: number; m9?: string; m10: boolean; m11: number | null; m12: number; m13: string; m14?: boolean };
type B15 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean; m7: number | null; m8: number; m9?: string; m10: boolean; m11: number | null; m12: number; m13: string; m14?: boolean };
type A16 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean; m7: number | null; m8: number; m9?: string; m10: boolean; m11: number | null; m12: number; m13: string; m14?: boolean; m15: number | null };
type B16 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean; m7: number | null; m8: number; m9?: string; m10: boolean; m11: number | null; m12: number; m13: string; m14?: boolean; m15: number | null };
type A17 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean; m7: number | null; m8: number; m9?: string; m10: boolean; m11: number | null; m12: number; m13: string; m14?: boolean; m15: number | null; m16: number };
type B17 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean; m7: number | null; m8: number; m9?: string; m10: boolean; m11: number | null; m12: number; m13: string; m14?: boolean; m15: number | null; m16: number };
type A20 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean; m7: number | null; m8: number; m9?: string; m10: boolean; m11: number | null; m12: number; m13: string; m14?: boolean; m15: number | null; m16: number; m17: string; m18: boolean; m19?: number | null };
type B20 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean; m7: number | null; m8: number; m9?: string; m10: boolean; m11: number | null; m12: number; m13: string; m14?: boolean; m15: number | null; m16: number; m17: string; m18: boolean; m19?: number | null };
type A30 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean; m7: number | null; m8: number; m9?: string; m10: boolean; m11: number | null; m12: number; m13: string; m14?: boolean; m15: number | null; m16: number; m17: string; m18: boolean; m19?: number | null; m20: number; m21: string; m22: boolean; m23: number | null; m24?: number; m25: string; m26: boolean; m27: number | null; m28: number; m29?: string };
type B30 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean; m7: number | null; m8: number; m9?: string; m10: boolean; m11: number | null; m12: number; m13: string; m14?: boolean; m15: number | null; m16: number; m17: string; m18: boolean; m19?: number | null; m20: number; m21: string; m22: boolean; m23: number | null; m24?: number; m25: string; m26: boolean; m27: number | null; m28: number; m29?: string };
type A31 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean; m7: number | null; m8: number; m9?: string; m10: boolean; m11: number | null; m12: number; m13: string; m14?: boolean; m15: number | null; m16: number; m17: string; m18: boolean; m19?: number | null; m20: number; m21: string; m22: boolean; m23: number | null; m24?: number; m25: string; m26: boolean; m27: number | null; m28: number; m29?: string; m30: boolean };
type B31 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean; m7: number | null; m8: number; m9?: string; m10: boolean; m11: number | null; m12: number; m13: string; m14?: boolean; m15: number | null; m16: number; m17: string; m18: boolean; m19?: number | null; m20: number; m21: string; m22: boolean; m23: number | null; m24?: number; m25: string; m26: boolean; m27: number | null; m28: number; m29?: string; m30: boolean };
type A32 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean; m7: number | null; m8: number; m9?: string; m10: boolean; m11: number | null; m12: number; m13: string; m14?: boolean; m15: number | null; m16: number; m17: string; m18: boolean; m19?: number | null; m20: number; m21: string; m22: boolean; m23: number | null; m24?: number; m25: string; m26: boolean; m27: number | null; m28: number; m29?: string; m30: boolean; m31: number | null };
type B32 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean; m7: number | null; m8: number; m9?: string; m10: boolean; m11: number | null; m12: number; m13: string; m14?: boolean; m15: number | null; m16: number; m17: string; m18: boolean; m19?: number | null; m20: number; m21: string; m22: boolean; m23: number | null; m24?: number; m25: string; m26: boolean; m27: number | null; m28: number; m29?: string; m30: boolean; m31: number | null };
type A33 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean; m7: number | null; m8: number; m9?: string; m10: boolean; m11: number | null; m12: number; m13: string; m14?: boolean; m15: number | null; m16: number; m17: string; m18: boolean; m19?: number | null; m20: number; m21: string; m22: boolean; m23: number | null; m24?: number; m25: string; m26: boolean; m27: number | null; m28: number; m29?: string; m30: boolean; m31: number | null; m32: number };
type B33 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean; m7: number | null; m8: number; m9?: string; m10: boolean; m11: number | null; m12: number; m13: string; m14?: boolean; m15: number | null; m16: number; m17: string; m18: boolean; m19?: number | null; m20: number; m21: string; m22: boolean; m23: number | null; m24?: number; m25: string; m26: boolean; m27: number | null; m28: number; m29?: string; m30: boolean; m31: number | null; m32: number };
type A63 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean; m7: number | null; m8: number; m9?: string; m10: boolean; m11: number | null; m12: number; m13: string; m14?: boolean; m15: number | null; m16: number; m17: string; m18: boolean; m19?: number | null; m20: number; m21: string; m22: boolean; m23: number | null; m24?: number; m25: string; m26: boolean; m27: number | null; m28: number; m29?: string; m30: boolean; m31: number | null; m32: number; m33: string; m34?: boolean; m35: number | null; m36: number; m37: string; m38: boolean; m39?: number | null; m40: number; m41: string; m42: boolean; m43: number | null; m44?: number; m45: string; m46: boolean; m47: number | null; m48: number; m49?: string; m50: boolean; m51: number | null; m52: number; m53: string; m54?: boolean; m55: number | null; m56: number; m57: string; m58: boolean; m59?: number | null; m60: number; m61: string; m62: boolean };
type B63 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean; m7: number | null; m8: number; m9?: string; m10: boolean; m11: number | null; m12: number; m13: string; m14?: boolean; m15: number | null; m16: number; m17: string; m18: boolean; m19?: number | null; m20: number; m21: string; m22: boolean; m23: number | null; m24?: number; m25: string; m26: boolean; m27: number | null; m28: number; m29?: string; m30: boolean; m31: number | null; m32: number; m33: string; m34?: boolean; m35: number | null; m36: number; m37: string; m38: boolean; m39?: number | null; m40: number; m41: string; m42: boolean; m43: number | null; m44?: number; m45: string; m46: boolean; m47: number | null; m48: number; m49?: string; m50: boolean; m51: number | null; m52: number; m53: string; m54?: boolean; m55: number | null; m56: number; m57: string; m58: boolean; m59?: number | null; m60: number; m61: string; m62: boolean };
type A64 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean; m7: number | null; m8: number; m9?: string; m10: boolean; m11: number | null; m12: number; m13: string; m14?: boolean; m15: number | null; m16: number; m17: string; m18: boolean; m19?: number | null; m20: number; m21: string; m22: boolean; m23: number | null; m24?: number; m25: string; m26: boolean; m27: number | null; m28: number; m29?: string; m30: boolean; m31: number | null; m32: number; m33: string; m34?: boolean; m35: number | null; m36: number; m37: string; m38: boolean; m39?: number | null; m40: number; m41: string; m42: boolean; m43: number | null; m44?: number; m45: string; m46: boolean; m47: number | null; m48: number; m49?: string; m50: boolean; m51: number | null; m52: number; m53: string; m54?: boolean; m55: number | null; m56: number; m57: string; m58: boolean; m59?: number | null; m60: number; m61: string; m62: boolean; m63: number | null };
type B64 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean; m7: number | null; m8: number; m9?: string; m10: boolean; m11: number | null; m12: number; m13: string; m14?: boolean; m15: number | null; m16: number; m17: string; m18: boolean; m19?: number | null; m20: number; m21: string; m22: boolean; m23: number | null; m24?: number; m25: string; m26: boolean; m27: number | null; m28: number; m29?: string; m30: boolean; m31: number | null; m32: number; m33: string; m34?: boolean; m35: number | null; m36: number; m37: string; m38: boolean; m39?: number | null; m40: number; m41: string; m42: boolean; m43: number | null; m44?: number; m45: string; m46: boolean; m47: number | null; m48: number; m49?: string; m50: boolean; m51: number | null; m52: number; m53: string; m54?: boolean; m55: number | null; m56: number; m57: string; m58: boolean; m59?: number | null; m60: number; m61: string; m62: boolean; m63: number | null };
type A65 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean; m7: number | null; m8: number; m9?: string; m10: boolean; m11: number | null; m12: number; m13: string; m14?: boolean; m15: number | null; m16: number; m17: string; m18: boolean; m19?: number | null; m20: number; m21: string; m22: boolean; m23: number | null; m24?: number; m25: string; m26: boolean; m27: number | null; m28: number; m29?: string; m30: boolean; m31: number | null; m32: number; m33: string; m34?: boolean; m35: number | null; m36: number; m37: string; m38: boolean; m39?: number | null; m40: number; m41: string; m42: boolean; m43: number | null; m44?: number; m45: string; m46: boolean; m47: number | null; m48: number; m49?: string; m50: boolean; m51: number | null; m52: number; m53: string; m54?: boolean; m55: number | null; m56: number; m57: string; m58: boolean; m59?: number | null; m60: number; m61: string; m62: boolean; m63: number | null; m64?: number };
type B65 = { m0: number; m1: string; m2: boolean; m3: number | null; m4?: number; m5: string; m6: boolean; m7: number | null; m8: number; m9?: string; m10: boolean; m11: number | null; m12: number; m13: string; m14?: boolean; m15: number | null; m16: number; m17: string; m18: boolean; m19?: number | null; m20: number; m21: string; m22: boolean; m23: number | null; m24?: number; m25: string; m26: boolean; m27: number | null; m28: number; m29?: string; m30: boolean; m31: number | null; m32: number; m33: string; m34?: boolean; m35: number | null; m36: number; m37: string; m38: boolean; m39?: number | null; m40: number; m41: string; m42: boolean; m43: number | null; m44?: number; m45: string; m46: boolean; m47: number | null; m48: number; m49?: string; m50: boolean; m51: number | null; m52: number; m53: string; m54?: boolean; m55: number | null; m56: number; m57: string; m58: boolean; m59?: number | null; m60: number; m61: string; m62: boolean; m63: number | null; m64?: number };
let seed = 11;
function below(limit: number): number {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return (seed >>> 8) % limit;
}
function member(at: number, round: number): string {
  return '"m' + at + '":' + [String(at * 7 + round), '"text ' + at + " of round " + round + ' that is longer than a short string"', at % 8 < 4 ? "true" : "false", round % 2 ? "null" : String(at)][at % 4];
}
function textOf(width: number, round: number, kind: number): string {
  const members: string[] = [];
  for (let at = 0; at < width; at++) if (!(at % 5 === 4 && width > 4 && kind % 3 === 1 && below(2))) members.push(member(at, round));
  for (let at = members.length - 1; at > 0; at--) {
    const other = below(at + 1);
    const held = members[at];
    members[at] = members[other];
    members[other] = held;
  }
  if (kind % 4 === 2) for (let count = 1 + below(3); count > 0; count--) members.splice(below(members.length + 1), 0, '"u' + count + below(3) + '":' + round);
  return "{" + members.join(",") + "}";
}
function check(width: number, first: (text: string) => unknown, second: (text: string) => unknown): void {
  let different = 0;
  const texts: string[] = [];
  for (let round = 0; round < 700; round++) texts.push(textOf(width, round, round));
  const kept: [unknown, string][] = [];
  for (let pass = 0; pass < 3; pass++) {
    for (let at = 0; at < texts.length; at++) {
      const value = (at + pass) % 2 ? first(texts[at]) : second(texts[at]);
      if (JSON.stringify(value) !== texts[at]) different++;
      if (at % 90 === pass) kept.push([value, texts[at]]);
      if (at % 257 === 256) collect();
    }
  }
  for (let at = 0; at < 300; at++) {
    const text = texts[at % 5];
    if (JSON.stringify(first(text)) !== text || JSON.stringify(second(text)) !== text) different++;
  }
  const list = "[" + texts.join(",") + "]";
  for (const [value, text] of kept) if (JSON.stringify(value) !== text) different++;
  console.log(width + " members: " + different + " differ");
}
check(1, text => JSON.parse(text) as A1, text => JSON.parse(text) as B1);
check(2, text => JSON.parse(text) as A2, text => JSON.parse(text) as B2);
check(3, text => JSON.parse(text) as A3, text => JSON.parse(text) as B3);
check(4, text => JSON.parse(text) as A4, text => JSON.parse(text) as B4);
check(7, text => JSON.parse(text) as A7, text => JSON.parse(text) as B7);
check(8, text => JSON.parse(text) as A8, text => JSON.parse(text) as B8);
check(9, text => JSON.parse(text) as A9, text => JSON.parse(text) as B9);
check(11, text => JSON.parse(text) as A11, text => JSON.parse(text) as B11);
check(12, text => JSON.parse(text) as A12, text => JSON.parse(text) as B12);
check(13, text => JSON.parse(text) as A13, text => JSON.parse(text) as B13);
check(14, text => JSON.parse(text) as A14, text => JSON.parse(text) as B14);
check(15, text => JSON.parse(text) as A15, text => JSON.parse(text) as B15);
check(16, text => JSON.parse(text) as A16, text => JSON.parse(text) as B16);
check(17, text => JSON.parse(text) as A17, text => JSON.parse(text) as B17);
check(20, text => JSON.parse(text) as A20, text => JSON.parse(text) as B20);
check(30, text => JSON.parse(text) as A30, text => JSON.parse(text) as B30);
check(31, text => JSON.parse(text) as A31, text => JSON.parse(text) as B31);
check(32, text => JSON.parse(text) as A32, text => JSON.parse(text) as B32);
check(33, text => JSON.parse(text) as A33, text => JSON.parse(text) as B33);
check(63, text => JSON.parse(text) as A63, text => JSON.parse(text) as B63);
check(64, text => JSON.parse(text) as A64, text => JSON.parse(text) as B64);
check(65, text => JSON.parse(text) as A65, text => JSON.parse(text) as B65);
{
  const texts: string[] = [];
  for (let round = 0; round < 3000; round++) texts.push(textOf(12, round, round));
  const list = "[" + texts.join(",") + "]";
  let different = 0;
  for (let pass = 0; pass < 3; pass++) if (JSON.stringify(JSON.parse(list) as A12[]) !== list || JSON.stringify(JSON.parse('[{"k":' + texts.join('},{"k":') + "}]") as Record<string, B12>[]) !== '[{"k":' + texts.join('},{"k":') + "}]") different++;
  console.log("3,000 orders of 12 members in one text: " + different + " differ");
}
{
  const texts: string[] = [];
  for (let round = 0; round < 3000; round++) texts.push(textOf(13, round, round));
  const list = "[" + texts.join(",") + "]";
  let different = 0;
  for (let pass = 0; pass < 3; pass++) if (JSON.stringify(JSON.parse(list) as A13[]) !== list || JSON.stringify(JSON.parse('[{"k":' + texts.join('},{"k":') + "}]") as Record<string, B13>[]) !== '[{"k":' + texts.join('},{"k":') + "}]") different++;
  console.log("3,000 orders of 13 members in one text: " + different + " differ");
}
{
  const texts: string[] = [];
  for (let round = 0; round < 3000; round++) texts.push(textOf(14, round, round));
  const list = "[" + texts.join(",") + "]";
  let different = 0;
  for (let pass = 0; pass < 3; pass++) if (JSON.stringify(JSON.parse(list) as A14[]) !== list || JSON.stringify(JSON.parse('[{"k":' + texts.join('},{"k":') + "}]") as Record<string, B14>[]) !== '[{"k":' + texts.join('},{"k":') + "}]") different++;
  console.log("3,000 orders of 14 members in one text: " + different + " differ");
}
{
  const texts: string[] = [];
  for (let round = 0; round < 3000; round++) texts.push(textOf(15, round, round));
  const list = "[" + texts.join(",") + "]";
  let different = 0;
  for (let pass = 0; pass < 3; pass++) if (JSON.stringify(JSON.parse(list) as A15[]) !== list || JSON.stringify(JSON.parse('[{"k":' + texts.join('},{"k":') + "}]") as Record<string, B15>[]) !== '[{"k":' + texts.join('},{"k":') + "}]") different++;
  console.log("3,000 orders of 15 members in one text: " + different + " differ");
}
