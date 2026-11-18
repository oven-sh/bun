// `${row.id}` is a text whatever stands in it, so `+` beside it joins texts: "1" + 10 is "110". Each function grows a text in a loop and varies what stands beside the template of one part.
interface Row { id: number; cents: number; big: bigint; on: boolean; none: null; gone: undefined; valued: object; worded: object; turned: object }
const rows: Row[] = [];
for (const digits of ["1", "2", "30", "-4", "0.5", "-0", "1e21"]) {
  const id = JSON.parse(digits);
  rows.push({
    id, cents: id * 10, big: BigInt(Math.trunc(id)) + 5n, on: id > 1, none: null, gone: undefined,
    valued: { valueOf() { return 7; } }, worded: { toString() { return "w"; } }, turned: { [Symbol.toPrimitive](hint: string) { return hint === "default" ? 9 : hint; } },
  });
}
const forms: Record<string, (page: Row[]) => string> = {
  aNumberBehind(page) { let text = ""; for (const row of page) text += `${row.id}` + row.cents + ";"; return text; },
  aNumberInFront(page) { let text = ""; for (const row of page) text += row.cents + `${row.id}` + ";"; return text; },
  nothingBehindTheNumber(page) { let text = ""; for (const row of page) text += `${row.id}` + row.cents; return text; },
  inBrackets(page) { let text = ""; for (const row of page) text += "$" + (`${row.id}` + row.cents) + ";"; return text; },
  aBigInt(page) { let text = ""; for (const row of page) text += `${row.id}` + row.big + ";"; return text; },
  aBoolean(page) { let text = ""; for (const row of page) text += `${row.id}` + row.on + ";"; return text; },
  aNull(page) { let text = ""; for (const row of page) text += `${row.id}` + row.none + ";"; return text; },
  anUndefined(page) { let text = ""; for (const row of page) text += `${row.id}` + row.gone + ";"; return text; },
  anObjectWithValueOf(page) { let text = ""; for (const row of page) text += `${row.id}` + row.valued + ";"; return text; },
  anObjectWithToString(page) { let text = ""; for (const row of page) text += `${row.id}` + row.worded + ";"; return text; },
  anObjectWithToPrimitive(page) { let text = ""; for (const row of page) text += `${row.id}` + row.turned + ";"; return text; },
  anotherTemplate(page) { let text = ""; for (const row of page) text += `${row.id}` + `${row.cents}` + ";"; return text; },
  theTextStandsFirst(page) { let text = ""; for (const row of page) text = text + `${row.id}` + row.cents + ";"; return text; },
  theTextStandsFirstAndBrackets(page) { let text = ""; for (const row of page) text = text + (`${row.id}` + row.cents) + ";"; return text; },
  aTernaryAroundTheTemplate(page) { let text = ""; for (const row of page) text += (row.on ? `${row.id}` : `${row.cents}`) + row.cents + ";"; return text; },
  aTernaryBeside(page) { let text = ""; for (const row of page) text += `${row.id}` + (row.on ? row.cents : row.id) + ";"; return text; },
  theTemplateAlone(page) { let text = ""; for (const row of page) text += `${row.id}`; return text; },
  twoNumbersThenTheTemplate(page) { let text = ""; for (const row of page) text += row.id + row.cents + `${row.id}` + ";"; return text; },
  otherOperators(page) { let text = ""; for (const row of page) text += (`${row.id}` as any) * 2 + ":" + (`${row.id}` === "1") + ":" + typeof `${row.id}` + ":" + `${row.id}`.length + ";"; return text; },
  severalParts(page) { let text = ""; for (const row of page) text += `${row.id}|${row.cents}` + row.cents + ";"; return text; },
};
for (const [name, form] of Object.entries(forms)) console.log(name, form(rows));
