// STATISTIC: StoresLeftOutOfTurnsLaidOut >= 1
// Under: --aot-testing=EmittersAloneTestEveryPosition: the turns are laid out as users build them, and every raw access asks its position at the run
// A variable of the module takes a local that the loop carries. The laid-out turns leave that store out and whoever leaves them makes up for it: but not where no turn has stored yet.
let m = 5;
function fail(c, stop) { if (c === stop) throw new Error("left"); }
function breakFirst(a, n, stop) { let t = 0.5; for (let c = 0; c < n; c++) { if (c === stop) break; t = t + a[c]; m = t; } return t; }
function returnFirst(a, n, stop) { let t = 0.5; for (let c = 0; c < n; c++) { if (c === stop) return t; t = t + a[c]; m = t; } return t; }
function throwFirst(a, n, stop) { let t = 0.5; for (let c = 0; c < n; c++) { if (c === stop) throw new Error("left"); t = t + a[c]; m = t; } return t; }
function calleeThrowsFirst(a, n, stop) { let t = 0.5; for (let c = 0; c < n; c++) { fail(c, stop); t = t + a[c]; m = t; } return t; }
function throwBetween(a, n, stop) { let t = 0.5; for (let c = 0; c < n; c++) { t = t + a[c]; if (c === stop) throw new Error("left"); m = t; } return t; }
function throwBehind(a, n, stop) { let t = 0.5; for (let c = 0; c < n; c++) { t = t + a[c]; m = t; if (c === stop) throw new Error("left"); } return t; }
function continueFirst(a, n, stop) { let t = 0.5; for (let c = 0; c < n; c++) { if (c === stop) continue; t = t + a[c]; m = t; } return t; }
function plainSum(a, n, stop) { let t = 0.5; for (let c = 0; c < n; c++) { if (c === stop) throw new Error("left"); t = t + c * 0.5; m = t; } return t; }
for (const run of [breakFirst, returnFirst, throwFirst, calleeThrowsFirst, throwBetween, throwBehind, continueFirst, plainSum])
  for (const n of [JSON.parse("8"), JSON.parse("17"), JSON.parse("100")])
    for (const stop of [JSON.parse("0"), JSON.parse("1"), JSON.parse("7"), JSON.parse("8"), JSON.parse("9"), JSON.parse("64"), JSON.parse("-1")]) {
      m = 5;
      const list = []; for (let i = 0; i < (n > 17 ? 100 : 8); i++) list.push(i + 0.5);
      let said; try { said = run(list, n, stop); } catch { said = "threw"; }
      console.log(run.name, n, stop, String(said), String(m));
    }
