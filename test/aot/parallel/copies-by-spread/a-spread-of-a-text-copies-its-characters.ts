// A text is the one primitive with properties of its own: `{ a, ...(c ? { p } : "xy") }` lays "0" and "1"; the empty text lays nothing. A text that may also be undefined is copied where it is a text.
function withText(a: number, on: boolean) { const o: any = { a, ...(on ? { p: a } : ("xy" as any)) }; return o; }
function withEmptyText(a: number, on: boolean) { const o: any = { a, ...(on ? { p: a } : ("" as any)) }; return o; }
function withTextOrNothing(a: number, text: string | undefined) { const o: any = { a, ...(text as any) }; return o; }
function withTextMade(a: number, on: boolean) { const o: any = { a, ...(on ? undefined : (String(a) + "!" as any)) }; return o; }
function show(o: any) { return JSON.stringify(o) + " " + Object.keys(o).join(); }
for (let i = 0; i < 4; i++)
  console.log(show(withText(i, !(i & 1))), show(withEmptyText(i, !(i & 1))), show(withTextOrNothing(i, i & 1 ? "ab" : undefined)), show(withTextMade(i, !(i & 1))));
