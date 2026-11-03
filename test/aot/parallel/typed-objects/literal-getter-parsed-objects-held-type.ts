// Two functions hold objects under one type, { readonly a; b } | { a; b }: in one a closure reads a parsed object through any, in the other a literal with a getter and a parsed object come to one variable of a loop.
function remade(n: number) {
  let held: { readonly a: number; b: number } | { a: number; b: number } | undefined = undefined;
  const look = () => {
    const v = held;
    if (v === undefined) return "nothing";
    return (v as any).ok ? { ok: true, value: (v as any).value + 1 } : { ok: false, error: (v as any).error + "!" };
  };
  if (n % 10 !== 3) held = JSON.parse('{"a":' + n + ',"b":2}');
  return look();
}
for (let n = 0; n < 1000; n++) { const last = remade(n); if (n < 5) console.log(JSON.stringify(last)); }
function aroundTheLoop(n: number) {
  const answers: unknown[] = [];
  let v: { readonly a: number; b: number } | { a: number; b: number } | null = null;
  for (let i = 0; i < 7; i++) {
    if (v !== null) answers.push(v.a + v.b);
    v = i % 3 === 0 ? { get a() { return n + 7; }, b: 2 } : i % 3 === 1 ? JSON.parse('{"a":' + n + ',"b":2}') : null;
  }
  return answers;
}
for (let n = 0; n < 300; n++) { const last = aroundTheLoop(n); if (n < 5) console.log(JSON.stringify(last)); }
