// a store into an object that was made a line above lays a value that looks like the one that lies there and is another: -0 over 0, 1 over true, "1" over 1, null over undefined, a second object with the same keys
function zero() { const box = { value: 0 }; box.value = -0; return box; }
function minusZero() { const box = { value: -0 }; box.value = 0; return box; }
function truth() { const box = { value: true }; box.value = 1; return box; }
function text() { const box = { value: 1 }; box.value = "1"; return box; }
function nothing() { const box = { value: undefined }; box.value = null; return box; }
function fraction() { const box = { value: 1 }; box.value = 1.5; return box; }
function twin(seed) { const one = { seed }; const two = { seed }; const box = { value: one }; box.value = two; return box.value === two && box.value !== one; }
function same(seed) { const box = { value: seed, count: 3 }; box.value = seed; box.count = 3; return box; }
function deed(box) { return typeof box.value + " " + String(box.value) + " " + Object.is(box.value, -0) + " " + Object.is(box.value, 0); }
console.log(deed(zero()), deed(minusZero()), deed(truth()), deed(text()), deed(nothing()), deed(fraction()), twin(1), JSON.stringify(same("s")));
for (let turn = 0; turn < 300; turn++) { zero(); minusZero(); truth(); text(); nothing(); fraction(); twin(turn); same(turn); }
console.log(deed(zero()), deed(minusZero()), deed(truth()), deed(text()), deed(nothing()), deed(fraction()), twin(2), JSON.stringify(same(NaN)), Object.is(same(NaN).value, NaN), Object.is(same(-0).value, -0));
