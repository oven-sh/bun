// The caller allocates the environment of its own variables and lends it to an inner function that it calls directly. Nothing else ever refers to that environment.
// `factor` is declared a number. Where it holds one, the comparison with a string folds away, so the typed path of `read` holds no store to `hits`.
// Where it holds a string the test of its type fails, the multiplication runs as unknown code with BecomeDirty in front of it, and the store to `hits` stands behind that: on no clean path.
// So on its normal edge the call writes nothing through the environment, which is right. At the landing BecomeDirty writes every heap, but it has no operands, and a writer without operands
// is taken to leave alone an allocation that nothing has retained (EliminateRedundantReads::isUnaffected, KillQuery::isConfined). What the caller stored in front of the call then counts as
// still there on both edges, and the read behind the call goes away.
// Build it without inlining too: inlined, there is no call.
let factor: number = 2;

function holder(round: number): string {
  let hits = round;
  let last = 0;
  function read(): number {
    const f = factor;
    const product = f * 3;
    if ((f as any) === "strike") {
      hits = -1;
      last = round;
    }
    return product;
  }
  const hitsBefore = hits;
  const got = read();
  return hitsBefore + " " + got + " " + hits + " " + last;
}

// The same with a function between the two: the environment is handed down twice, and both calls come back at their landings.
function outer(round: number): string {
  let hits = round;
  function read(): number {
    const f = factor;
    const product = f * 3;
    if ((f as any) === "strike") hits = -1;
    return product;
  }
  function between(): number {
    const before = hits;
    const got = read();
    return got + before - hits;
  }
  const hitsBefore = hits;
  const got = between();
  return hitsBefore + " " + got + " " + hits;
}

for (let round = 0; round < 300; round++) {
  const strikes = round % 100 === 99;
  if (strikes) factor = "strike" as any;
  const line = holder(round) + " | " + outer(round);
  factor = 2;
  if (strikes || round === 0) console.log(round + ": " + line);
}
