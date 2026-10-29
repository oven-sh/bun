// The TypeError for calling `o.m(..)` names `m` also where `o` is of a written type and `m` is a field that may hold what cannot be called.
interface Holder { distinctiveName: any }
interface Maybe { distinctiveName?: (x: number) => number }
function callIt(o: Holder): unknown {
  return o.distinctiveName(1);
}
function callItWithMany(o: Holder): unknown {
  return o.distinctiveName(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
}
function callItInTheMiddle(o: Holder): unknown {
  const result = o.distinctiveName(1);
  return [result];
}
function callWhatMayBeAbsent(o: Maybe): number {
  return o.distinctiveName!(1);
}
const values: any[] = [(x: number) => x + 1, 5, undefined, null, true, 1.5];
const holders: Holder[] = values.map((v): Holder => ({ distinctiveName: v }));
const maybes: Maybe[] = [{ distinctiveName: x => x + 2 }, {}, { distinctiveName: undefined }];
for (let round = 0; round < 2; round++) {
  for (const holder of holders) {
    const out: string[] = [];
    for (const run of [() => callIt(holder), () => callItWithMany(holder), () => callItInTheMiddle(holder)]) {
      try {
        out.push(String(run()));
      } catch (e: any) {
        out.push(e.constructor.name + (String(e.message).includes("distinctiveName") ? " names it" : " DOES NOT NAME IT"));
      }
    }
    console.log((typeof holder.distinctiveName === "function" ? "a function" : String(holder.distinctiveName)) + ": " + out.join(" | "));
  }
  for (const maybe of maybes) {
    try {
      console.log(callWhatMayBeAbsent(maybe));
    } catch (e: any) {
      console.log(e.constructor.name);
    }
  }
}
