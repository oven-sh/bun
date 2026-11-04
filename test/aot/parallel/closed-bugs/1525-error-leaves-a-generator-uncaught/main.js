// Exit code: 1
function make() {
  const made = new Error("deep");
  return made;
}
function throwGiven(value) {
  throw value;
}
function throwNew() {
  throw new Error("new");
}
function throwAgainWhatCalleeThrew(value) {
  try {
    throwGiven(value);
  } catch (error) {
    throw error;
  }
}
function throwAgainNew() {
  try {
    throwNew();
  } catch (error) {
    throw error;
  }
}
function throwAgainWhatEngineMade() {
  try {
    null.missing;
  } catch (error) {
    throw error;
  }
}
function catchAroundCatch(value) {
  try {
    throwAgainWhatCalleeThrew(value);
  } catch (error) {
    throw error;
  }
}
function finallyAroundCatch(value) {
  try {
    throwAgainWhatCalleeThrew(value);
  } finally {
    console.log("finally");
  }
}
function busyCatchAroundCatch(value) {
  try {
    throwAgainWhatCalleeThrew(value);
  } catch (error) {
    console.log("caught", error.message);
    throw error;
  }
}
function twoCatchesInOne(value) {
  try {
    try {
      throwGiven(value);
    } catch (inner) {
      throw inner;
    }
  } catch (outer) {
    throw outer;
  }
}
function threeCatchesInOne(value) {
  try {
    try {
      try {
        throw value;
      } catch (first) {
        throw first;
      }
    } catch (second) {
      throw second;
    }
  } catch (third) {
    throw third;
  }
}
function returnsWhatWasThrownAgain(value) {
  try {
    throwAgainWhatCalleeThrew(value);
  } catch (error) {
    return error;
  }
}
function catchAroundFinallyAroundCatch(value) {
  try {
    try {
      throwAgainWhatCalleeThrew(value);
    } finally {
      console.log("finally");
    }
  } catch (error) {
    throw error;
  }
}
function finallyAroundCatchAroundCatch(value) {
  try {
    try {
      throwAgainWhatCalleeThrew(value);
    } catch (error) {
      throw error;
    }
  } finally {
    console.log("finally");
  }
}
function catchAroundEngineMade() {
  try {
    throwAgainWhatEngineMade();
  } catch (error) {
    throw error;
  }
}
function usingAroundCatch(value) {
  using resource = { [Symbol.dispose]() { console.log("disposed"); } };
  throwAgainWhatCalleeThrew(value);
}
function catchWithoutBindingAroundCatch(value) {
  try {
    throwAgainWhatCalleeThrew(value);
  } catch {
    throw make();
  }
}
async function asyncThrowsAgain(value) {
  try {
    await null;
    throwGiven(value);
  } catch (error) {
    throw error;
  }
}
async function asyncCatchAroundCatch(value) {
  try {
    await asyncThrowsAgain(value);
  } catch (error) {
    throw error;
  }
}
function* generatorThrowsAgain(value) {
  try {
    yield 1;
    throwGiven(value);
  } catch (error) {
    throw error;
  }
}
function loopAroundCatch(value) {
  for (const turn of new Set([0, 1])) {
    try {
      if (turn) throwAgainWhatCalleeThrew(value);
    } catch (error) {
      throw error;
    }
  }
}
const forms = {
  "a": () => setTimeout(function onTimer() { throwAgainWhatCalleeThrew(make()); }, 1),
  "b": () => setTimeout(function onTimer() { catchAroundCatch(make()); }, 1),
  "c": () => setTimeout(function onTimer() { finallyAroundCatch(make()); }, 1),
  "d": () => setTimeout(function onTimer() { busyCatchAroundCatch(make()); }, 1),
  "e": () => setTimeout(function onTimer() { twoCatchesInOne(make()); }, 1),
  "f": () => setTimeout(function onTimer() { threeCatchesInOne(make()); }, 1),
  "g": () => setTimeout(function onTimer() { throwGiven(returnsWhatWasThrownAgain(make())); }, 1),
  "h": () => setTimeout(function onTimer() { catchAroundFinallyAroundCatch(make()); }, 1),
  "i": () => setTimeout(function onTimer() { finallyAroundCatchAroundCatch(make()); }, 1),
  "j": () => setTimeout(function onTimer() { catchAroundEngineMade(); }, 1),
  "k": () => setTimeout(function onTimer() { usingAroundCatch(make()); }, 1),
  "l": () => setTimeout(function onTimer() { catchWithoutBindingAroundCatch(make()); }, 1),
  "m": () => setTimeout(function onTimer() { asyncCatchAroundCatch(make()); }, 1),
  "n": () => setTimeout(function onTimer() { for (const x of generatorThrowsAgain(make())) console.log(x); }, 1),
  "o": () => setTimeout(function onTimer() { loopAroundCatch(make()); }, 1),
  "p": () => setTimeout(function onTimer() { try { throwAgainNew(); } catch (error) { console.log(error.stack); } }, 1),
  "q": () => setTimeout(function onTimer() { try { catchAroundEngineMade(); } catch (error) { console.log(error.stack); } }, 1),
  "r": () => setTimeout(function onTimer() { try { throwAgainNew(); } catch (error) { throw error; } }, 1),
  "s": () => setTimeout(function onTimer() { catchAroundCatch({ a: 1 }); }, 1),
  "t": () => setTimeout(function onTimer() { catchAroundCatch("text"); }, 1),
  "u": () => { process.on("uncaughtException", error => console.log("heard", error.stack)); setTimeout(function onTimer() { catchAroundCatch(make()); }, 1); },
  "v": () => catchAroundCatch(make()),
  "w": () => queueMicrotask(function onMicrotask() { twoCatchesInOne(make()); }),
  "x": () => [1].forEach(function each() { catchAroundCatch(make()); }),
};
forms[process.argv[2]]();
