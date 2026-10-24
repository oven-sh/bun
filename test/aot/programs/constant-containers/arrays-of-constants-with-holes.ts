function few(): (number | undefined)[] { return [1, , 3]; }
function fractions(): (number | undefined)[] { return [1.5, , , 4.5]; }
function only(): undefined[] { return [, , ,]; }
function mixed(): unknown[] { return [null, , true, , 2]; }
function many(): (number | undefined)[] { return [0, 1, , 3, 4, 5, , 7, 8, 9, 10, , 12, 13, 14, 15, 16, , 18, 19, 20, 21, , 23]; }
function manyFractions(): (number | undefined)[] { return [0.5, , 2.5, 3.5, 4.5, 5.5, 6.5, , 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, , 15.5, 16.5, 17.5, 18.5, 19.5]; }
function withText(): unknown[] { return ["a", , "b", , "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q"]; }
for (const [name, make] of [["few", few], ["fractions", fractions], ["only", only], ["mixed", mixed], ["many", many], ["manyFractions", manyFractions], ["withText", withText]] as [string, () => any[]][]) {
  const a = make();
  const seen: string[] = []; a.forEach((v, i) => seen.push(i + ":" + v));
  let walked = ""; for (const v of a) walked += v + ",";
  let byIndex = ""; for (let i = 0; i < a.length; i++) byIndex += (i in a ? "+" : "-") + a[i] + ",";
  console.log(name, a.length, Object.keys(a).join(), JSON.stringify(a), seen.join(), walked, byIndex);
  console.log(name, a.indexOf(undefined), a.includes(undefined), a.lastIndexOf(undefined), a.findIndex(v => v === undefined), [...a].length, Object.keys([...a]).length, a.flat().length, a.join("|"), a.hasOwnProperty(1), Object.getOwnPropertyDescriptor(a, 1) === undefined);
  console.log(name, JSON.stringify(a.map(v => v)), Object.keys(a.map(v => v)).join(), JSON.stringify(a.filter(() => true)), a.reduce((n: number) => n + 1, 0), JSON.stringify(a.slice(1)), Object.keys(a.slice(1)).join(), JSON.stringify(a.concat([1])), Object.keys(a.concat([1])).join());
  const b = make(); b[1] = 5; const c = make();
  console.log(name, 1 in b, 1 in c, JSON.stringify(b), JSON.stringify(c), JSON.stringify(make().sort()), JSON.stringify(make().reverse()), Object.keys(make().reverse()).join());
  const d = structuredClone(make()); console.log(name, Object.keys(d).join(), d.length);
}
