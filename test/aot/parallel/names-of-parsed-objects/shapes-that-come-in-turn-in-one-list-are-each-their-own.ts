// COUNTER: TransitionsCachedForParsedNames >= 4
// Four shapes by turns in ONE list, with names in common at the same places: what stands in front of an object never tells its names, so each goes by the cache of names. A transition laid under another shape of as many names would give an object the other's names.
const shape = (i: number): string => [`{"p":${i},"q":"x${i}","r":true}`, `{"q":"y${i}","p":${i},"s":null}`, `{"u":[${i}],"p":${i}}`, `{"q":${i},"u":"z","p":false}`][i % 4]!;
const text = "[" + Array.from({ length: 32 }, (_, i) => shape(i)).join() + "]";
const said: string[] = [];
for (let round = 0; round < 4; round++) {
  const made: Record<string, unknown>[] = JSON.parse(text);
  said.push(made.map(one => Object.keys(one).join("")).join() + " " + (JSON.stringify(made) === text) + " " + made.every((one, i) => JSON.stringify(one) === shape(i)));
}
console.log(new Set(said).size, said[0]);
