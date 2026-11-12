// answers: with-library
// # A loop over a view whose head asks the lesser of its written bound and the view's room handed every last turn over to the other copy of the loop,
// # which is rare: the written relation was asked there again, and whatever stands behind the loop was reached through rare code alone and was laid
// # out, and given registers, as rare code: also the way on which the function returns. Where the written bound is the one that is reached the typed
// # copy leaves by itself.
// # Every call that is written here passes a whole number, so the bound is expected to be one. The calls through `hidden` are the ways on which the
// # written bound is NOT what is reached, or is no whole number, or the room moves while the loop runs: there the other copy goes on as written.
// # f1 = twoLoops
// # RUN(PLACES): order f1:Body mechanisms=all
// # REQUIRES(PLACES): x86_64 as-written
// # PLACES: loop head, rare region
// # RUN: run-in-shell $SHELL
// # CHECK: 33 of 33 of 33
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function twoLoops(n, d, e) { let s = 0; for (let j = 0; j < n; j++) d[j] = e[j] + 1; for (let k = 0; k < n; k++) s += d[k] * e[k]; return s; }
function upTo(n, d) { let s = 0; let j = 0; for (j = 0; j <= n; j++) s += d[j]; return s + j * 1000; }
function counts(n, d) { let turns = 0; for (let j = 0; j < n; j++) { d[j] = j; turns++; } return turns; }
function overLength(d, grow) { let s = 0; let turns = 0; for (let j = 0; j < d.length; j++) { grow(j); s += d[j]; turns++; } return s + turns * 1000; }
function filled(length: number): Float64Array { const made = new Float64Array(length); for (let i = 0; i < length; i++) made[i] = i + 0.5; return made; }
(globalThis as any).kept = [twoLoops, upTo, counts, overLength];
const hidden: any = (globalThis as any).kept;
for (let warm = 0; warm < 3; warm++) report(twoLoops(4, filled(4), filled(4)));
report(twoLoops(3, filled(4), filled(4)));
report(twoLoops(0, filled(4), filled(4)));
report(upTo(3, filled(4)));
report(upTo(2, filled(4)));
report(counts(4, filled(4)));
report(counts(3, filled(8)));
report(overLength(filled(3), () => {}));
report(hidden[0](-1, filled(4), filled(4)));
report(hidden[0](4, filled(2), filled(4)));
report(hidden[0](4, filled(4), filled(2)));
report(hidden[0](6, filled(4), filled(4)));
report(hidden[0](2.5, filled(4), filled(4)));
report(hidden[0]("3", filled(4), filled(4)));
report(hidden[0](NaN, filled(4), filled(4)));
report(hidden[0](undefined, filled(4), filled(4)));
report(hidden[0]({ valueOf() { return 2; } }, filled(4), filled(4)));
report(hidden[0](4, filled(0), filled(0)));
report(hidden[0](3, [1.5, 2.5, 3.5], filled(4)));
report(hidden[1](4, filled(4)));
report(hidden[1](-1, filled(4)));
report(hidden[1](1.5, filled(4)));
report(hidden[1](7, filled(4)));
report(hidden[2](7, filled(4)));
const roomy = new ArrayBuffer(16, { maxByteLength: 64 });
const tracking = new Float64Array(roomy);
tracking[0] = 1.5;
tracking[1] = 2.5;
report(hidden[3](tracking, at => { if (at === 1) roomy.resize(40); }));
report(tracking.length);
report(hidden[3](tracking, at => { if (at === 1) roomy.resize(16); }));
report(tracking.length);
report(hidden[3](tracking, at => { if (at === 0) roomy.resize(0); }));
report(tracking.length);
report("end");
