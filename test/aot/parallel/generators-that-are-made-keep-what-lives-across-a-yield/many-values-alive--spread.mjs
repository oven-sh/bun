const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function* steps(base) { const v0 = base + 0; const v1 = "t" + (base + 1); const v2 = { at: base * 2.5 }; const v3 = base + 3; const v4 = "t" + (base + 4); const v5 = { at: base * 5.5 }; const v6 = base + 6; const v7 = "t" + (base + 7); const v8 = { at: base * 8.5 }; const v9 = base + 9; const v10 = "t" + (base + 10); const v11 = { at: base * 11.5 }; const v12 = base + 12; const v13 = "t" + (base + 13); const v14 = { at: base * 14.5 }; const v15 = base + 15; const v16 = "t" + (base + 16); const v17 = { at: base * 17.5 }; const v18 = base + 18; const v19 = "t" + (base + 19); const v20 = { at: base * 20.5 }; const v21 = base + 21; const v22 = "t" + (base + 22); const v23 = { at: base * 23.5 }; const v24 = base + 24; const v25 = "t" + (base + 25); const v26 = { at: base * 26.5 }; const v27 = base + 27; const v28 = "t" + (base + 28); const v29 = { at: base * 29.5 }; const v30 = base + 30; const v31 = "t" + (base + 31); const v32 = { at: base * 32.5 }; const v33 = base + 33; const v34 = "t" + (base + 34); const v35 = { at: base * 35.5 }; const v36 = base + 36; const v37 = "t" + (base + 37); const v38 = { at: base * 38.5 }; const v39 = base + 39; yield 0; yield [v0, v1, v2.at, v3, v4, v5.at, v6, v7, v8.at, v9, v10, v11.at, v12, v13, v14.at, v15, v16, v17.at, v18, v19, v20.at, v21, v22, v23.at, v24, v25, v26.at, v27, v28, v29.at, v30, v31, v32.at, v33, v34, v35.at, v36, v37, v38.at, v39].join(); }
function run() {
  const it = steps(2);
  globalThis.held = it;
  try { note([...it].map(show).join(" ")); } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
