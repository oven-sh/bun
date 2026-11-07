// Prints the frames between a constructor and the function that has it constructed. A call that is written `Reflect.construct(target, list)` constructs in place;
// where the function is called by value, under another name, through another function or with a list of all its arguments, the stack lists it.
function frames(error) {
  return error.stack
    .split("\n")
    .slice(1)
    .map(line =>
      line
        .trim()
        .replace(/^at /, "")
        .replace(/ \(.*$/, "")
        .replace(/^.*[\\/]/, ""),
    )
    .filter(
      name =>
        !/^(module code|moduleEvaluation|evaluate|require|asyncFunctionResume|loadAndEvaluateModule|processTicksAndRejections|anonymous|<anonymous>)/.test(
          name,
        ),
    )
    .join(" < ");
}
class F {
  constructor() {
    this.frames = frames(new Error("here"));
  }
}
class N extends F {}
function G() {
  this.frames = frames(new Error("here"));
}
const natives = { construct: Reflect.construct };
const R = Reflect;
const byValue = Reflect.construct;
const list = [];
const all = [F, []];
const ways = {
  written() {
    const made = Reflect.construct(F, []);
    return made;
  },
  writtenWithNewTarget() {
    const made = Reflect.construct(F, [], N);
    return made;
  },
  writtenWithAList() {
    const made = Reflect.construct(F, list);
    return made;
  },
  writtenWithFourArguments() {
    const made = Reflect.construct(F, [], N, 4);
    return made;
  },
  writtenOfAFunction() {
    const made = Reflect.construct(G, [1, 2]);
    return made;
  },
  writtenInParentheses() {
    const made = Reflect.construct(F, []);
    return made;
  },
  writtenWithAString() {
    const made = Reflect["construct"](F, []);
    return made;
  },
  optionalCall() {
    const made = Reflect.construct?.(F, []);
    return made;
  },
  optionalMember() {
    const made = Reflect?.construct(F, []);
    return made;
  },
  otherName() {
    const made = R.construct(F, []);
    return made;
  },
  ofGlobalThis() {
    const made = globalThis.Reflect.construct(F, []);
    return made;
  },
  otherHolder() {
    const made = natives.construct(F, []);
    return made;
  },
  byValue() {
    const made = byValue(F, []);
    return made;
  },
  byLocalValue() {
    const construct = Reflect.construct;
    const made = construct(F, [], N);
    return made;
  },
  comma() {
    const made = (0, Reflect.construct)(F, []);
    return made;
  },
  spreadAll() {
    const made = Reflect.construct(...all);
    return made;
  },
  byCall() {
    const made = Reflect.construct.call(null, F, []);
    return made;
  },
  byApply() {
    const made = Reflect.construct.apply(null, [F, []]);
    return made;
  },
  byReflectApply() {
    const made = Reflect.apply(Reflect.construct, null, [F, []]);
    return made;
  },
  bound() {
    const made = Reflect.construct.bind(null, F)([]);
    return made;
  },
  asCallback() {
    const made = [F].map(target => Reflect.construct(target, []))[0];
    return made;
  },
  handedOn() {
    const made = ((construct, target) => construct(target, []))(Reflect.construct, F);
    return made;
  },
  parameterNamedReflect() {
    const made = (Reflect => Reflect.construct(F, []))(R);
    return made;
  },
  impostor() {
    const Reflect = { construct: (target, list) => new target(...list) };
    const made = Reflect.construct(F, []);
    return made;
  },
  inTailPosition() {
    "use strict";
    return Reflect.construct(F, []);
  },
  byValueInTailPosition() {
    "use strict";
    return byValue(F, []);
  },
};
for (const [name, way] of Object.entries(ways)) {
  for (let turn = 0; turn < 2; turn++) {
    try {
      console.log(name, turn, way().frames);
    } catch (error) {
      console.log(name, turn, error.name, frames(error));
    }
  }
}
const failing = {
  noConstructor() {
    const made = Reflect.construct(() => {}, []);
    return made;
  },
  noConstructorByValue() {
    const made = byValue(() => {}, []);
    return made;
  },
  noList() {
    const made = Reflect.construct(F, 1);
    return made;
  },
  noListByValue() {
    const made = byValue(F, 1);
    return made;
  },
  noNewTarget() {
    const made = Reflect.construct(F, [], 1);
    return made;
  },
  oneArgument() {
    const made = Reflect.construct(F);
    return made;
  },
};
for (const [name, way] of Object.entries(failing)) {
  try {
    console.log(name, way().frames);
  } catch (error) {
    console.log(name, error.name, error.message, "|", frames(error));
  }
}
