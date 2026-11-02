// The text of a function can be evaluated again, which is how a function is sent to a worker or a page, also where a block in it declares a function.
function evaluate(text) {
  try {
    return (0, eval)("(" + text + ")");
  } catch (error) {
    return () => error.name + ": " + error.message;
  }
}
function inABlock() {
  {
    function declared() {
      return 1;
    }
    return declared();
  }
}
function inAnArm(yes) {
  if (yes) {
    function declared(a, b) {
      return a + b;
    }
    return declared(1, 1);
  }
}
function usedAheadOfItsDeclaration() {
  {
    const answer = declared();
    function declared() {
      return 3;
    }
    return answer;
  }
}
function usedTwice() {
  {
    function declared() {
      return 2;
    }
    return declared() + declared();
  }
}
function inALoop() {
  let sum = 0;
  for (let i = 0; i < 3; i++) {
    function declared() {
      return i + 1;
    }
    sum += declared();
  }
  return sum - 1;
}
function inATry() {
  try {
    function declared() {
      return 6;
    }
    return declared();
  } finally {
  }
}
function inAClause(which) {
  switch (which) {
    case 0:
      function declared() {
        return 7;
      }
      return declared();
  }
}
function twoDeep() {
  {
    function outerOne() {
      {
        function innerOne() {
          return 8;
        }
        return innerOne();
      }
    }
    return outerOne();
  }
}
function onOneLine() { { function declared() { return 9; } return declared(); } }
const holder = {
  method() {
    {
      function declared() {
        return 10;
      }
      return declared();
    }
  },
};
class Kind {
  field = () => {
    {
      function declared() {
        return 11;
      }
      return declared();
    }
  };
}
function makes() {
  return function made() {
    {
      function declared() {
        return 12;
      }
      return declared();
    }
  };
}
console.log("a block:", evaluate(String(inABlock))());
console.log("an arm of if:", evaluate(String(inAnArm))(true));
console.log("used ahead of its declaration:", evaluate(String(usedAheadOfItsDeclaration))());
console.log("used twice:", evaluate(String(usedTwice))());
console.log("a loop:", evaluate(String(inALoop))());
console.log("try:", evaluate(String(inATry))());
console.log("a clause:", evaluate(String(inAClause))(0));
console.log("two deep:", evaluate(String(twoDeep))());
console.log("on one line:", evaluate(String(onOneLine))());
console.log("in a method:", evaluate("{" + String(holder.method) + "}").method?.() ?? evaluate("{" + String(holder.method) + "}")());
console.log("in a field:", evaluate(String(new Kind().field))());
console.log("in a function made in a function:", evaluate(String(makes()))());
