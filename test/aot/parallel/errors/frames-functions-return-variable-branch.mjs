// Between `const v = frames();` and `return v;` stands a branch that is never taken. Some of them declare a name that the function
// can see. Each row prints the names of the frames that frames() sees.
function frames() {
  const lines = new Error("taken").stack.split("\n").slice(1);
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
function use(value) {
  return value;
}
const flag = use(true);
function variable() {
  const v = frames();
  if (false) var unused = 1;
  return v;
}
function variableWithoutAValue() {
  const v = frames();
  if (false) var unused;
  return v;
}
function variableInABlock() {
  const v = frames();
  if (false) {
    var unused = 1;
  }
  return v;
}
function variableBehindACall() {
  const v = frames();
  if (false) {
    use(1);
    var unused = use(2);
  }
  return v;
}
function letInABlock() {
  const v = frames();
  if (false) {
    let unused = 1;
  }
  return v;
}
function constantInABlock() {
  const v = frames();
  if (false) {
    const unused = 1;
  }
  return v;
}
function listPattern() {
  const v = frames();
  if (false) var [first, second] = [];
  return v;
}
function objectPattern() {
  const v = frames();
  if (false) var { first, second: other } = {};
  return v;
}
function listPatternOfNothing() {
  const v = frames();
  if (false) var [] = [];
  return v;
}
function objectPatternOfNothing() {
  const v = frames();
  if (false) var {} = {};
  return v;
}
function functionInABlock() {
  const v = frames();
  if (false) {
    function inner() {}
  }
  return v;
}
function asyncFunctionInABlock() {
  const v = frames();
  if (false) {
    async function inner() {}
  }
  return v;
}
function generatorInABlock() {
  const v = frames();
  if (false) {
    function* inner() {}
  }
  return v;
}
function classInABlock() {
  const v = frames();
  if (false) {
    class Inner {}
  }
  return v;
}
function counterOfALoop() {
  const v = frames();
  if (false) for (var i = 0; i < 1; i++) use(i);
  return v;
}
function letCounterOfALoop() {
  const v = frames();
  if (false) for (let i = 0; i < 1; i++) use(i);
  return v;
}
function keyOfALoop() {
  const v = frames();
  if (false) for (var key in {}) use(key);
  return v;
}
function constantKeyOfALoop() {
  const v = frames();
  if (false) for (const key in {}) use(key);
  return v;
}
function elementOfALoop() {
  const v = frames();
  if (false) for (var each of []) use(each);
  return v;
}
function bodyOfALoop() {
  const v = frames();
  if (false)
    for (;;) {
      var unused = 1;
    }
  return v;
}
function bodyOfAWhile() {
  const v = frames();
  if (false)
    while (flag) {
      var unused = 1;
    }
  return v;
}
function whileWithoutADeclaration() {
  const v = frames();
  if (false) while (flag) use(1);
  return v;
}
function bodyOfADoWhile() {
  const v = frames();
  if (false)
    do {
      var unused = 1;
    } while (flag);
  return v;
}
function labeledBlock() {
  const v = frames();
  if (false)
    label: {
      var unused = 1;
    }
  return v;
}
function tryBlock() {
  const v = frames();
  if (false)
    try {
      var unused = 1;
    } catch {}
  return v;
}
function catchBlock() {
  const v = frames();
  if (false)
    try {
      use(1);
    } catch {
      var unused = 1;
    }
  return v;
}
function finallyBlock() {
  const v = frames();
  if (false)
    try {
      use(1);
    } finally {
      var unused = 1;
    }
  return v;
}
function tryWithoutADeclaration() {
  const v = frames();
  if (false)
    try {
      use(1);
    } catch {}
  return v;
}
function caseOfASwitch() {
  const v = frames();
  if (false)
    switch (flag) {
      case true:
        var unused = 1;
    }
  return v;
}
function switchWithoutADeclaration() {
  const v = frames();
  if (false)
    switch (flag) {
      case true:
        use(1);
    }
  return v;
}
function branchInTheBranch() {
  const v = frames();
  if (false) {
    if (flag) var unused = 1;
  }
  return v;
}
function elseInTheBranch() {
  const v = frames();
  if (false) {
    if (flag) use(1);
    else var unused = 1;
  }
  return v;
}
function elseNeverTaken() {
  const v = frames();
  if (true) {
  } else var unused = 1;
  return v;
}
function elseNeverTakenBehindACall() {
  const v = frames();
  if (true) use(1);
  else var unused = 1;
  return v;
}
function returnInTheBranch() {
  const v = frames();
  if (false) return 1;
  return v;
}
function throwInTheBranch() {
  const v = frames();
  if (false) throw 1;
  return v;
}
function variableThatIsReadLater() {
  const v = frames();
  if (false) var unused = 1;
  return v ?? unused;
}
function branchOnZero() {
  const v = frames();
  if (0) var unused = 1;
  return v;
}
function branchOnNull() {
  const v = frames();
  if (null) var unused = 1;
  return v;
}
function branchInABlock() {
  const v = frames();
  {
    if (false) var unused = 1;
  }
  return v;
}
function betweenConstants() {
  const first = frames();
  if (false) var unused = 1;
  const second = first;
  return second;
}
function behindTheSecondConstant() {
  const first = frames();
  const second = first;
  if (false) var unused = 1;
  return second;
}
const arrow = () => {
  const v = frames();
  if (false) var unused = 1;
  return v;
};
const holder = {
  method() {
    const v = frames();
    if (false) var unused = 1;
    return v;
  },
};
const rows = [
  variable,
  variableWithoutAValue,
  variableInABlock,
  variableBehindACall,
  letInABlock,
  constantInABlock,
  listPattern,
  objectPattern,
  listPatternOfNothing,
  objectPatternOfNothing,
  functionInABlock,
  asyncFunctionInABlock,
  generatorInABlock,
  classInABlock,
  counterOfALoop,
  letCounterOfALoop,
  keyOfALoop,
  constantKeyOfALoop,
  elementOfALoop,
  bodyOfALoop,
  bodyOfAWhile,
  whileWithoutADeclaration,
  bodyOfADoWhile,
  labeledBlock,
  tryBlock,
  catchBlock,
  finallyBlock,
  tryWithoutADeclaration,
  caseOfASwitch,
  switchWithoutADeclaration,
  branchInTheBranch,
  elseInTheBranch,
  elseNeverTaken,
  elseNeverTakenBehindACall,
  returnInTheBranch,
  throwInTheBranch,
  variableThatIsReadLater,
  branchOnZero,
  branchOnNull,
  branchInABlock,
  betweenConstants,
  behindTheSecondConstant,
  arrow,
  holder.method,
];
for (const row of rows) console.log(row.name + ":", row());
