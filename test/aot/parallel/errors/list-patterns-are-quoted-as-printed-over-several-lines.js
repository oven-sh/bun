// A list that takes values and is written over several lines is printed over lines by Bun, each as deep as the code around it, and a message quotes that.
function twoBlanks(v) {
  const [
    x,
    y,
  ] = v;
  return x + y;
}
function fourBlanks(v) {
    const [
        x,
        y
    ] = v;
    return x + y;
}
function tabs(v) {
	const [
		x,
		y,
	] = v;
	return x + y;
}
function noIndentation(v) {
const [
x,
y,
] = v;
return x + y;
}
function crooked(v) {
          const [
  x, // the first
        y,
                 ] = v;
  return x + y;
}
function brokenBehindTheFirst(v) {
  const [x,
    y] = v;
  return x + y;
}
function brokenInFrontOfTheEnd(v) {
  const [x, y
  ] = v;
  return x + y;
}
function nothingInLines(v) {
  const [
  ] = v;
  return 1;
}
function holesInLines(v) {
  const [
    ,
    x,
    ,
  ] = v;
  return x;
}
function listsInLists(v) {
  const [
    [
      [
        x,
      ],
    ],
    [ y ],
  ] = v;
  return x + y;
}
function oneLineAroundLines(v) {
  const [[
    x,
  ]] = v;
  return x;
}
function objectInLines(v) {
  const [
    {
      x,
      y: [
        z,
      ],
    },
  ] = v;
  return x + z;
}
function objectInOneLine(v) {
  const [{
    x,
    y,
  }] = v;
  return x + y;
}
function listInObject(v) {
  const {
    p: [
      x,
    ],
  } = { p: v };
  return x;
}
function listInOneLineObject(v) {
  const { p: [
    x,
  ] } = { p: v };
  return x;
}
function defaults(v) {
  const [
    a = 1,
    b = {
      c: 1,
      d: [
        2,
      ],
    },
    e = [1,
      2],
    f = Math.max(
      1,
      2,
    ),
    g = v
      .a
      .b,
  ] = v;
  return a;
}
function defaultInOneLine(v) {
  const [x = {
    a: 1,
    b: 2,
  }] = v;
  return x;
}
function parameters(a, [
  x,
  y,
], b) {
  return x + y;
}
const arrow = ([
  x,
  y,
]) => x + y;
function assigned(v) {
  let x, y;
  [
    x,
    y,
  ] = v;
  return x + y;
}
function caught(v) {
  try {
    throw v;
  } catch ([
    x,
  ]) {
    return x;
  }
}
function loop(v) {
  for (const [
    x,
    y,
  ] of v) return x + y;
}
function loopThatAssigns(v) {
  let x, y;
  for ([
    x,
    y,
  ] of v) return x + y;
}
class Holder {
  method(v) {
    const [
      x,
    ] = v;
    return x;
  }
  static fixed(v) {
    const [
      x,
    ] = v;
    return x;
  }
  field = (v) => {
    const [
      x,
    ] = v;
    return x;
  };
  static {
    Holder.madeInBlock = function (v) {
      const [
        x,
      ] = v;
      return x;
    };
  }
}
function inSwitch(v, k) {
  switch (k) {
    case 1:
      const [
        x,
      ] = v;
      return x;
    case 2: {
      const [
        y,
      ] = v;
      return y;
    }
    default:
      let z;
      [
        z,
      ] = v;
      return z;
  }
}
function withoutBraces(v, k) {
  let x;
  if (k === 1)
    [
      x,
    ] = v;
  else if (k === 2)
    [
      x,
    ] = v;
  else
    [
      x,
    ] = v;
  for (let i = 0; i < 1; i++)
    [
      x,
    ] = v;
  return x;
}
function labeled(v) {
  let x;
  outer: for (;;) {
    [
      x,
    ] = v;
    break outer;
  }
  return x;
}
function tried(v, k) {
  try {
    if (k === 1) {
      const [
        x,
      ] = v;
      return x;
    }
    throw v;
  } catch (e) {
    if (k === 2) {
      const [
        x,
      ] = e;
      return x;
    }
  } finally {
    if (k === 3) {
      const [
        x,
      ] = v;
    }
  }
}
function run(f, v) { return f(v); }
function inArguments(v) {
  return run(
    function (w) {
      const [
        x,
      ] = w;
      return x;
    },
    v,
  );
}
function inListOfFunctions(v) {
  return [
    (w) => {
      const [
        x,
      ] = w;
      return x;
    },
  ][0](v);
}
function inOneLineListOfFunctions(v) {
  return [(w) => {
    const [
      x,
    ] = w;
    return x;
  }][0](v);
}
function inObjects(v) {
  return {
    a: {
      b(w) {
        const [
          x,
        ] = w;
        return x;
      },
    },
  }.a.b(v);
}
function inOneLineObject(v) {
  return { a(w) {
    const [
      x,
    ] = w;
    return x;
  } }.a(v);
}
const madeByCall = (function () {
  return function (v) {
    const [
      x,
    ] = v;
    return x;
  };
})();
const arrowInArrow = (v) => ([
  x,
]) => x;
function* generated(v) {
  const [
    x,
  ] = v;
  yield x;
}
// An executable keeps the text of a function that something may ask for it.
globalThis.kept = {
  twoBlanks, fourBlanks, tabs, noIndentation, crooked, brokenBehindTheFirst, brokenInFrontOfTheEnd, nothingInLines, holesInLines, listsInLists, oneLineAroundLines,
  objectInLines, objectInOneLine, listInObject, listInOneLineObject, defaults, defaultInOneLine, arrow, assigned, caught, loop, loopThatAssigns,
  labeled, inArguments, inListOfFunctions, inOneLineListOfFunctions, inObjects, inOneLineObject, madeByCall,
  parameters: v => parameters(1, v, 2), method: v => new Holder().method(v), fixed: v => Holder.fixed(v), field: v => new Holder().field(v), madeInBlock: v => Holder.madeInBlock(v),
  firstCase: v => inSwitch(v, 1), caseWithBlock: v => inSwitch(v, 2), lastCase: v => inSwitch(v, 3),
  afterIf: v => withoutBraces(v, 1), afterElseIf: v => withoutBraces(v, 2), afterElse: v => withoutBraces(v, 3), afterFor: v => withoutBraces([v], 3),
  inTry: v => tried(v, 1), inCatch: v => tried(v, 2), inFinally: v => tried(v, 3),
  arrowInArrow: v => arrowInArrow(1)(v), generated: v => generated(v).next(),
  Holder, inSwitch, withoutBraces, tried, run, parametersItself: parameters, arrowInArrowItself: arrowInArrow, generatedItself: generated,
};

for (const nothing of [null, undefined]) {
  for (const [name, take] of Object.entries(globalThis.kept)) {
    if (/^[A-Z]|^(inSwitch|withoutBraces|tried|run)$|Itself$/.test(name)) continue;
    for (const [depth, value] of [["outer", nothing], ["inner", [nothing]], ["innermost", [[nothing]]], ["in an object", [{ y: nothing }]]]) {
      try {
        take(value);
      } catch (error) {
        console.log(name, depth, nothing + ":", error.name, JSON.stringify(error.message));
      }
    }
  }
}
