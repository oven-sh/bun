// Each function cuts a part out of a string, runs a loop, and returns the part. The callers read characters, smaller parts and lengths of what they get.
function cutLiteral(turns) {
  const part = "abcdef".slice(1);
  while (turns--);
  return part;
}
function cutGiven(text, from, turns) {
  const part = text.substring(from);
  for (let turn = 0; turn < turns; turn++);
  return part;
}
function cutAgain(text, turns) {
  let part = text.slice(1);
  while (turns--) part = part.slice(1);
  return part;
}
function cutEither(text, first, turns) {
  const part = first ? text.slice(1, 4) : text.substr(2, 3);
  while (turns--);
  return part;
}
function forward(text, turns) {
  return cutGiven(text, 2, turns);
}

cutLiteral(1);
console.log(cutLiteral(1)[0], cutLiteral(2)[4], cutLiteral(2)[5]);
console.log(
  cutLiteral(1).slice(0),
  cutLiteral(1).slice(2),
  cutLiteral(1).slice(-2),
  cutLiteral(1).slice(1).slice(1)[0],
);
console.log(cutLiteral(1).at(0), cutLiteral(1).at(-1), cutLiteral(1).at(9));
console.log(
  cutLiteral(1).charAt(0),
  cutLiteral(1).charAt(9) === "",
  cutLiteral(1).substring(0, 1),
  cutLiteral(1).substr(1, 2),
);
console.log(
  cutLiteral(1).charCodeAt(0),
  cutLiteral(1).codePointAt(1),
  cutLiteral(1).length,
  cutLiteral(1).slice(1).length,
);

cutGiven("uvwxyz", 1, 1);
console.log(
  cutGiven("uvwxyz", 1, 2)[0],
  cutGiven("uvwxyz", 5, 2)[0],
  cutGiven("uvwxyz", 6, 2)[0],
  cutGiven("uvwxyz", 9, 2)[0],
);
console.log(
  cutGiven("uvwxyz", 1, 2).slice(1),
  cutGiven("uvw" + "xyz".repeat(2), 2, 2).slice(1, 3),
  cutGiven("é中😀z", 1, 1)[0],
);

cutAgain("abcdef", 1);
console.log(
  cutAgain("abcdef", 0)[0],
  cutAgain("abcdef", 2)[0],
  cutAgain("abcdef", 9)[0],
  cutAgain("abcdef", 3).slice(1),
);

cutEither("abcdef", true, 1);
console.log(
  cutEither("abcdef", true, 1)[0],
  cutEither("abcdef", false, 1)[0],
  cutEither("abcdef", false, 1).slice(1),
  cutEither("abcdef", true, 1).at(-1),
);

forward("abcdef", 1);
console.log(
  forward("abcdef", 1)[0],
  forward("abcdef", 1).slice(1),
  forward("abcdef", 1).charAt(3),
  forward("ab", 1)[0],
);
