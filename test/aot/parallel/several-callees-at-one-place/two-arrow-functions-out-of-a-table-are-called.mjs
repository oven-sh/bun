const A = n => ({ n }), B = n => ({ n }); const t = { a: A, b: B }; const pick = i => i & 1 ? t.a : t.b; let s = 0; for (let i = 0; i < 4; i++) s += pick(i)(i).n; console.log(s);
