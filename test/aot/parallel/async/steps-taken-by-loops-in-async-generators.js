// The result object of a step that only a `for await` or a `yield*` takes is the engine's own, and the producer keeps it for its next step. Whoever takes the step gets the value that was
// yielded to it: a loop in an async generator, a `yield*`, two loops that take turns over one generator, and a loop that goes on while another still waits.
async function* inner() { yield { n: 1 }; yield { n: 2 }; return { n: 3 }; }
function* plain() { yield { n: 4 }; yield { n: 5 }; }
async function* delegates() { const last = yield* inner(); yield last; yield* plain(); }
async function* loops() { for await (const each of delegates()) yield each.n; }
async function collect(source) { const all = []; for await (const each of source) all.push(each); return JSON.stringify(all); }
console.log("one loop", await collect(loops()), await collect(delegates()));

async function* shared() { for (let i = 0; i < 6; i++) yield { i }; }
async function* relays(source) { for await (const each of source) { await null; yield each; } }
const one = shared();
console.log("two loops", ...(await Promise.all([collect(one), collect(one)])));
const other = shared();
console.log("two relays", ...(await Promise.all([collect(relays(other)), collect(relays(other))])));

// The value that a loop holds is its own: the next step of the producer does not change it.
async function* holds(source) {
  let before;
  for await (const each of source) {
    if (before) yield [before.i, each.i];
    before = each;
  }
}
console.log("held", await collect(holds(shared())));

// Steps that are asked for by hand get result objects of their own.
const byHand = shared();
const results = [await byHand.next(), await byHand.next()];
for await (const each of byHand) if (each.i === 3) break;
console.log("by hand", JSON.stringify(results), JSON.stringify(await byHand.next()));
