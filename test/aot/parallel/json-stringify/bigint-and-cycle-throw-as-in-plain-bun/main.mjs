// The same error, with the same message, however deep the value lies, and the next call writes a whole text again.
function row(id, inner) { return { id, inner }; }
function attempt(value) { try { return JSON.stringify(value); } catch (error) { return error.constructor.name + ": " + error.message; } }
const ring = row(1, null);
ring.inner = row(2, ring);
const self = row(3, null);
self.inner = self;
for (let turn = 0; turn < 2; ++turn) {
    console.log(attempt(row(4, 5n)));
    console.log(attempt(row(6, row(7, 8n))));
    console.log(attempt(ring));
    console.log(attempt(self));
    console.log(attempt([row(9, self)]));
    console.log(attempt(row(10, row(11, null))));
}
