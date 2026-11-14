// a side yields
function* ask(a: any): Generator<number, boolean, any> { return !((yield 1) && a || (yield 2)); }
for (const a of [0, 1]) for (const sent of [0, "x"]) { const it = ask(a); const seen = []; let step = it.next(); while (!step.done) { seen.push(step.value); step = it.next(sent); } console.log(a, String(sent), seen.join(), step.value); }
