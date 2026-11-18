// An await in a try rejects: the way to the handler leaves the block at the suspension, in front of all that stands behind it, and meets the other ways below. What is read or stored there was named on neither way alone.
// Under: --aot-check=Validate: what the piece of a block behind a suspension names does not hold below the block where a handler leads there too: a text that let it hold stopped the compiler on three bodies of a large program
const out = [];
async function* caught(waits) {
  const kept = ({ tag: "k", n: 1 });
  let got = ({ tag: "g", n: 0 }), turns = 0;
  yield 0;
  for (const wait of waits) {
    try { got = ({ tag: "g", n: await wait }); turns++; } catch (error) { got = ({ tag: "e", n: error.n }); }
    yield kept.tag + got.tag + got.n;
    out.push(got.tag + turns + kept.n);
  }
}
async function* readBehind(waits) {
  const kept = { tag: "b", n: 1 };
  let got = 0;
  yield 0;
  for (let i = 0; i < waits.length; i++) {
    try { got = (await waits[i]) + kept.n; } catch (error) { got = error.n; }
    yield kept.tag + got;
  }
}
async function* thrownInto() {
  const kept = ({ tag: "t", n: 2 });
  let seen = ({ tag: "s", n: 0 });
  for (let turn = 0; turn < 4; turn++) {
    try { seen = ({ tag: "s", n: yield kept.n + turn }); } catch (error) { seen = ({ tag: "c", n: error }); } finally { out.push("f" + turn); }
    await null;
    out.push(seen.tag + seen.n + kept.tag);
  }
}
function* plainly() {
  const kept = ({ tag: "p", n: 3 });
  let seen = ({ tag: "s", n: 0 });
  for (let turn = 0; turn < 3; turn++) {
    try { seen = ({ tag: "s", n: yield kept.n + turn }); } catch (error) { seen = ({ tag: "c", n: error }); }
    yield seen.tag + seen.n;
    out.push(seen.n + kept.tag);
  }
}
for await (const line of caught([1, Promise.reject(({ tag: "r", n: 7 })), Promise.resolve(3), Promise.reject(({ tag: "r", n: 9 }))])) out.push(line);
for await (const line of readBehind([1, Promise.reject({ n: 7 }), Promise.resolve(3), Promise.reject({ n: 9 })])) out.push(line);
const it = thrownInto();
out.push((await it.next()).value, (await it.next(5)).value, (await it.throw(6)).value, (await it.next(7)).value, (await it.throw(8)).done);
const steps = plainly();
out.push(steps.next().value, steps.next(1).value, steps.next().value, steps.throw(2).value, steps.next().value, steps.next(3).value);
console.log(out.join(" "));
