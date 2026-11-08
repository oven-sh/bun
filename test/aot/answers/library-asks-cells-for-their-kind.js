// answers: with-library
// # the text of the library asks what it is handed whether it is a promise, and takes a short way where it is. What an allocation and a store have made in the place of Promise.resolve(), and what the ramp of an async function in which nothing suspends has settled, are handed to all(), race(), then() and catch(): if such a promise were not in every way what the engine makes, these would differ
// # f1 = fulfilled
// # RUN(FORM): walk f1 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: FulfillFreshPromise
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 6 of 6 of 6
// # CHECK-NEXT: exited with 0
function fulfilled(n) { return Promise.resolve(n); }
function thenable(n) { return { then(resolve) { resolve(n); } }; }
async function viaAsync(n) { return n; }
async function all() { return (await Promise.all([1, fulfilled(2), thenable(3), viaAsync(4)])).join(); }
async function raced() { return await Promise.race([fulfilled(5), thenable(6)]); }
async function chained() { return await fulfilled(8).then(value => fulfilled(value + 1)).then(value => value * 2); }
async function caughtLater() { return await fulfilled(9).then(value => { throw "thrown " + value; }).catch(error => "caught " + error); }
async function twice() { const made = fulfilled(10); const first = await made; const second = await made; return first + second; }
report(await all());
report(await raced());
report(await chained());
report(await caughtLater());
report(await twice());
report("end");
