// Neither the captured value nor the closure has to exist until the loop has ended.
function patternOrUndefined(turn) {
  const value = turn % 20 === 7 ? /a/g : undefined;
  let kept = null;
  for (let i = 0; i < 4; i++) if (i === 2) kept = () => value;
  return kept() === value && String(value);
}

function oneOfTwoPatterns(turn) {
  const value = turn % 20 === 7 ? /a/g : /b/;
  let kept = null;
  for (let i = 0; i < 4; i++) if (i === 2) kept = () => value;
  return kept().flags + kept().source;
}

function listOrUndefined(turn) {
  const value = turn % 20 === 7 ? [turn, 2] : undefined;
  let kept = null;
  for (let i = 0; i < 4; i++) if (i === 2) kept = () => value;
  return kept() === value && String(value);
}

function patternBesideNumbers(turn) {
  const value = turn % 20 === 7 ? /a/g : undefined;
  let kept = null;
  for (let i = 0; i < 4; i++) if (i === 2) kept = () => [value, turn, i];
  return kept()[0] === value && kept().join();
}

function closureInsideClosure(turn) {
  const value = turn % 20 === 7 ? /a/g : undefined;
  let kept = null;
  for (let i = 0; i < 4; i++) if (i === 2) kept = () => () => value;
  return kept()() === value && String(value);
}

for (let turn = 0; turn < 60; turn++)
  console.log(turn, patternOrUndefined(turn), oneOfTwoPatterns(turn), listOrUndefined(turn), patternBesideNumbers(turn), closureInsideClosure(turn));
