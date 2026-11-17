const symbols = [Symbol.iterator, Symbol.unscopables, Symbol.toStringTag, Symbol.toPrimitive, Symbol.species];
const which: number[] = JSON.parse("[0,1,2,3,4]");
for (const at of which) {
  const key: any = symbols[at];
  const list = [1, 2];
  const ofList = (list as any)[key];
  const ofText = ("ab" as any)[key];
  const ofMap = (new Map([[1, 2]]) as any)[key];
  const ofDate = (new Date(0) as any)[key];
  console.log(at, typeof ofList, typeof ofText, typeof ofMap, typeof ofDate);
  if (at === 0)
    console.log(
      [...ofList.call(list)].join(),
      [...ofText.call("ab")].join(),
      [...ofMap.call(new Map([[1, 2]]))].join(),
    );
  if (at === 1) console.log(Object.keys(ofList).sort().join());
  if (at === 2) console.log(String(ofMap));
  if (at === 3) console.log(ofDate.call(new Date(0), "number"));
}
