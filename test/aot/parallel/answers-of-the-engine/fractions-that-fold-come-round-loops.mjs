// Folding puts a number with a fraction in the place of a quotient, a product or a sum. A look at a loop has typed that operation by its row, which says between which integers the result lies.
// The type of the number names the two integers around it, so what comes round, and what a function of Math or an operator makes of it, lies within the preview: the build does not stop.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function show(value) { return Object.is(value, -0) ? "-0" : String(value); }
function truncated(y) { let b = y, d = 7; let i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(d / 3); } return b; }
report(show(truncated(1.5)));
report(show(truncated(0)));
function quotient(y) { let b = 0, d = 7; let i = 0; while (i < (y & 3) + 1) { i++; b = d / 3; } return b; }
report(show(quotient(1.5)));
function negative(y) { let b = 0, d = -7; let i = 0; while (i < (y & 3) + 1) { i++; b = d / 3; } return b; }
report(show(negative(2)));
function rounded(y) { let a = 0, b = 0, c = 0, e = 0, d = -1; let i = 0; while (i < (y & 3) + 1) { i++; a = Math.ceil(d / 3); b = Math.round(d / 3); c = Math.floor(d / 3); e = Math.trunc(d / 3); } return show(a) + " " + show(b) + " " + show(c) + " " + show(e); }
report(rounded(1));
function ruled(y) { let a = 0, b = 0, c = 0, e = 0, d = -7; let i = 0; while (i < (y & 3) + 1) { i++; a = Math.abs(d / 3); b = Math.sign(d / 3); c = Math.min(d / 3, i); e = Math.max(d / 3, i / 2); } return show(a) + " " + show(b) + " " + show(c) + " " + show(e); }
report(ruled(1));
function summed(y) { let a = 0, b = 0, c = 0, e = 0, d = 7; let i = 0; while (i < (y & 3) + 1) { i++; a = d / 3 + i; b = d / 3 - i; c = -(d / 3); e = d * 0.5 + 1; } return show(a) + " " + show(b) + " " + show(c) + " " + show(e); }
report(summed(2));
function written(y) { let a = 0, b = 0; let i = 0; while (i < (y & 3) + 1) { i++; a = 0.5; b = Math.trunc(-0.5); } return show(a) + " " + show(b); }
report(written(1));
function nearTheEnd(y) { let a = 0, b = 0, d = 9007199254740991; let i = 0; while (i < (y & 3) + 1) { i++; a = d / 2; b = Math.floor(-d / 2); } return show(a) + " " + show(b); }
report(nearTheEnd(1));
function tiny(y) { let a = 0, b = 0, d = 1; let i = 0; while (i < (y & 3) + 1) { i++; a = d / 1e300; b = Math.ceil(-d / 1e300); } return show(a) + " " + show(b); }
report(tiny(1));
report("end");
