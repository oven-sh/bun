// Prints the frames that a function called in `const v = f(); .. return v;` sees, for each statement that stands between the two and leaves nothing to run.
function frames() {
  const lines = new Error("x").stack.split("\n").slice(1);
  return lines
    .map(line =>
      line
        .trim()
        .replace(/^at /, "")
        .replace(/[ @(].*/, ""),
    )
    .filter(name => !/[\\/]/.test(name))
    .join(" | ");
}
function touch() {}
const flag = process.argv.length > 99;
function removedBranch() {
  const v = frames();
  if (false) console.log("never");
  return v;
}
function removedBranchInBraces() {
  const v = frames();
  if (false) {
    console.log("never");
  }
  return v;
}
function removedBranchThatNamesTheVariable() {
  const v = frames();
  if (false) console.log(v);
  return v;
}
function removedBranchWithEmptyElse() {
  const v = frames();
  if (false) console.log("never");
  else;
  return v;
}
function removedBranchWithEmptyBlockAsElse() {
  const v = frames();
  if (false) console.log("never");
  else {
  }
  return v;
}
function removedElse() {
  const v = frames();
  if (true) {
  } else console.log("never");
  return v;
}
function takenEmptyBranch() {
  const v = frames();
  if (true) {
  }
  return v;
}
function takenEmptyStatement() {
  const v = frames();
  if (true);
  return v;
}
function zeroAsTest() {
  const v = frames();
  if (0) console.log("never");
  return v;
}
function nullAsTest() {
  const v = frames();
  if (null) console.log("never");
  return v;
}
function emptyTextAsTest() {
  const v = frames();
  if ("") console.log("never");
  return v;
}
function negatedTest() {
  const v = frames();
  if (!1) console.log("never");
  return v;
}
function typeofAsTest() {
  const v = frames();
  if (typeof 1 === "string") console.log("never");
  return v;
}
function testWithACall() {
  const v = frames();
  if ((touch(), false)) console.log("never");
  return v;
}
function unknownTestOfEmptyBranch() {
  const v = frames();
  if (flag) {
  }
  return v;
}
function emptyBlock() {
  const v = frames();
  {
  }
  return v;
}
function blockInBlock() {
  const v = frames();
  {
    {
    }
  }
  return v;
}
function blockOfAnEmptyStatement() {
  const v = frames();
  {
  }
  return v;
}
function blockOfARemovedBranch() {
  const v = frames();
  {
    if (false) console.log("never");
  }
  return v;
}
function twoEmptyBlocks() {
  const v = frames();
  {
  }
  {
  }
  return v;
}
function whileFalse() {
  const v = frames();
  while (false) console.log("never");
  return v;
}
function forFalse() {
  const v = frames();
  for (; false; ) console.log("never");
  return v;
}
function doWhileFalse() {
  const v = frames();
  do {} while (false);
  return v;
}
function numberStatement() {
  const v = frames();
  0;
  return v;
}
function textStatement() {
  const v = frames();
  ("text");
  return v;
}
function voidStatement() {
  const v = frames();
  void 0;
  return v;
}
function undefinedStatement() {
  const v = frames();
  undefined;
  return v;
}
function voidOfAVariable() {
  const v = frames();
  void flag;
  return v;
}
function voidOfACall() {
  const v = frames();
  void touch();
  return v;
}
function negatedVariable() {
  const v = frames();
  !flag;
  return v;
}
function variableStatement() {
  const v = frames();
  flag;
  return v;
}
function thisStatement() {
  const v = frames();
  this;
  return v;
}
function nullStatement() {
  const v = frames();
  null;
  return v;
}
function trueStatement() {
  const v = frames();
  true;
  return v;
}
function bigIntStatement() {
  const v = frames();
  10n;
  return v;
}
function templateStatement() {
  const v = frames();
  `text`;
  return v;
}
function sumStatement() {
  const v = frames();
  1 + 2;
  return v;
}
function typeofVariable() {
  const v = frames();
  typeof flag;
  return v;
}
function functionStatement() {
  const v = frames();
  (function () {});
  return v;
}
function arrowStatement() {
  const v = frames();
  () => {};
  return v;
}
function memberStatement() {
  const v = frames();
  process.argv;
  return v;
}
function varWithoutInitializer() {
  const v = frames();
  var unused;
  return v;
}
function letWithoutInitializer() {
  const v = frames();
  let unused;
  return v;
}
function emptyTryFinally() {
  const v = frames();
  try {
  } finally {
  }
  return v;
}
function emptyTryCatch() {
  const v = frames();
  try {
  } catch {}
  return v;
}
function emptySwitch() {
  const v = frames();
  switch (0) {
  }
  return v;
}
function labeledEmptyBlock() {
  const v = frames();
  label: {
  }
  return v;
}
for (const f of [
  removedBranch,
  removedBranchInBraces,
  removedBranchThatNamesTheVariable,
  removedBranchWithEmptyElse,
  removedBranchWithEmptyBlockAsElse,
  removedElse,
  takenEmptyBranch,
  takenEmptyStatement,
  zeroAsTest,
  nullAsTest,
  emptyTextAsTest,
  negatedTest,
  typeofAsTest,
  testWithACall,
  unknownTestOfEmptyBranch,
  emptyBlock,
  blockInBlock,
  blockOfAnEmptyStatement,
  blockOfARemovedBranch,
  twoEmptyBlocks,
  whileFalse,
  forFalse,
  doWhileFalse,
  numberStatement,
  textStatement,
  voidStatement,
  undefinedStatement,
  voidOfAVariable,
  voidOfACall,
  negatedVariable,
  variableStatement,
  thisStatement,
  nullStatement,
  trueStatement,
  bigIntStatement,
  templateStatement,
  sumStatement,
  typeofVariable,
  functionStatement,
  arrowStatement,
  memberStatement,
  varWithoutInitializer,
  letWithoutInitializer,
  emptyTryFinally,
  emptyTryCatch,
  emptySwitch,
  labeledEmptyBlock,
])
  console.log(f.name + ":", f());
