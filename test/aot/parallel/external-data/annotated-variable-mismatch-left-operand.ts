// An object that comes through `any` into an annotated variable and does not fit the declared record type stays as it is, whichever operand of `??`, `||`, `&&`, `?:` or `,` it is,
// and through `??=`, `||=` and `&&=` too. As plain Bun, line by line.
interface Nested { cwd: string }
interface Wanted { id: string; ctx: Nested }
const parse = (text: string): any => JSON.parse(text);
const lacking = '{"id":"y"}';
const fitting = '{"id":"z","ctx":{"cwd":"/"}}';
const kept: Wanted = { id: "k", ctx: { cwd: "/" } };
const list: any[] = [parse(lacking)];
const cases: [string, (text: string) => unknown][] = [
  ["alone", text => { const v: Wanted = parse(text); return v.id; }],
  ["?? right", text => { const v: Wanted = parse("null") ?? parse(text); return v.id; }],
  ["?? left", text => { const v: Wanted = parse(text) ?? parse("null"); return v.id; }],
  ["?? left, typed right", text => { const v: Wanted = parse(text) ?? kept; return v.id; }],
  ["|| right", text => { const v: Wanted = parse("0") || parse(text); return v.id; }],
  ["|| left", text => { const v: Wanted = parse(text) || parse("0"); return v.id; }],
  ["|| left, typed right", text => { const v: Wanted = parse(text) || kept; return v.id; }],
  ["&& right", text => { const v: Wanted = parse("1") && parse(text); return v.id; }],
  ["?: then", text => { const v: Wanted = text.length > 0 ? parse(text) : parse("null"); return v.id; }],
  ["?: else", text => { const v: Wanted = text.length === 0 ? parse("null") : parse(text); return v.id; }],
  ["comma", text => { const v: Wanted = (parse("0"), parse(text)); return v.id; }],
  ["nested ?? left", text => { const v: Wanted = (parse(text) ?? parse("null")) ?? parse("null"); return v.id; }],
  ["?? in ||", text => { const v: Wanted = (parse("null") ?? parse(text)) || parse("0"); return v.id; }],
  ["element || other", _ => { const v: Wanted = list[0]! || kept; return v.id; }],
  ["assigned ?? left", text => { let v: Wanted = kept; v = parse(text) ?? parse("null"); return v.id; }],
  ["assigned || left", text => { let v: Wanted = kept; v = parse(text) || parse("0"); return v.id; }],
  ["??=", text => { let v: Wanted | undefined = parse("null") ?? undefined; v ??= parse(text); return v!.id; }],
  ["||=", text => { let v: Wanted | undefined = parse("null") ?? undefined; v ||= parse(text); return v!.id; }],
  ["&&=", text => { let v: Wanted | undefined = kept; v &&= parse(text); return v!.id; }],
  ["the value of ??=", text => { let v: Wanted | undefined = parse("null") ?? undefined; const w: any = (v ??= parse(text)); return w.id + typeof w.ctx; }],
  ["read of the missing member", text => { const v: Wanted = parse(text) ?? kept; return typeof v.ctx; }],
  ["the same object", text => { const from = parse(text); const v: Wanted = from ?? kept; const back: any = v; return text === lacking ? back === from : back.id === from.id; }],
];
for (const text of [lacking, fitting]) {
  for (const [name, run] of cases) {
    let said: string;
    try { said = String(run(text)); } catch (error) { said = "threw " + (error as Error).constructor.name; }
    console.log(name + ": " + said);
  }
}
