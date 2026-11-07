// A warning starts below the host function that makes it, and below `ctor`: process.emitWarning with no ctor, with a ctor as the second, the third and the fourth argument and in the options, a class, a bound function, an object that is no function, the wrapper of util.deprecate, a function that is on no frame, an async function that has been resumed, and under a limit of one frame and of none. So does the warning of a port that is posted to itself. A timer keeps its own frame. The output is stored: run-parallel.ts does not hold the names of frames to plain Bun.
// Env: NODE_NO_WARNINGS=1
const util = require("node:util");
const framesAboveRow = stack => {
  // The functions of the runtime that run a tick have another place in an executable.
  const frames = stack.split("\n").filter(line => /^\s+at /.test(line) && !line.includes("(native:"));
  const end = frames.findIndex(line => /\bat row \(/.test(line));
  return (end < 0 ? frames : frames.slice(0, end)).map(line =>
    line
      .trim()
      .replace(/^at /, "")
      .replace(/ \(.*\)$/, ""),
  );
};
process.on("warning", warning => {
  console.log(
    typeof warning.stack === "string"
      ? `${warning.stack.split("\n")[0]} | ${framesAboveRow(warning.stack).join(" < ") || "no frames"}`
      : `${warning.message} | ${typeof warning.stack}`,
  );
});
function row(run) {
  run();
}

row(function plain() {
  process.emitWarning("no ctor");
});
row(function callsFourth() {
  function fourth() {
    process.emitWarning("4th argument", "T", "C", fourth);
  }
  fourth();
});
row(function callsThird() {
  function third() {
    process.emitWarning("3rd argument", "T", third);
  }
  third();
});
row(function callsSecond() {
  function second() {
    process.emitWarning("2nd argument", second);
  }
  second();
});
row(function callsOption() {
  function option() {
    process.emitWarning("options.ctor", { ctor: option });
  }
  option();
});
row(function callsDeep() {
  function inner() {
    process.emitWarning("ctor is three frames up", "T", "C", deep);
  }
  function middle() {
    inner();
  }
  function deep() {
    middle();
  }
  deep();
});
row(function constructs() {
  class Made {
    constructor() {
      process.emitWarning("ctor is the class", { ctor: Made });
    }
  }
  new Made();
});
row(function callsNamed() {
  function named() {
    process.emitWarning("ctor is an object with a name", { ctor: { name: "named" } });
  }
  named();
});
row(function callsAbsent() {
  function absent() {}
  process.emitWarning("ctor is on no frame", "T", "C", absent);
});
row(function callsBound() {
  function target() {
    process.emitWarning("ctor is a bound function", { ctor: bound });
  }
  const bound = target.bind(null);
  bound();
});
row(function user() {
  util.deprecate(function target() {}, "util.deprecate with a code", "DEP_AOT_TEST")();
});
row(function user() {
  util.deprecate(function target() {}, "util.deprecate with no code")();
});
row(function callsLimited() {
  function limited() {
    Error.stackTraceLimit = 1;
    process.emitWarning("limit of 1");
    function ctor() {
      process.emitWarning("limit of 1 below ctor", { ctor });
    }
    ctor();
    Error.stackTraceLimit = 0;
    process.emitWarning("limit of 0");
    Error.stackTraceLimit = 10;
  }
  limited();
});
row(function posts() {
  const { port1, port2 } = new MessageChannel();
  port1.postMessage(null, [port2]);
});
row(function timer() {
  clearTimeout(setTimeout(() => {}, NaN));
});
async function resumed(message) {
  await 1;
  process.emitWarning(message, { ctor: resumed });
}
async function awaitsResumed(message) {
  await resumed(message);
}
// The warnings above have queued a tick, so this one is made below the function that runs the ticks.
awaitsResumed("ctor is an async function that is resumed under a tick");
setImmediate(() => {
  awaitsResumed("ctor is an async function that is resumed in a turn of its own");
});
/* Output:
Warning: no ctor | plain
T: 4th argument | callsFourth
T: 3rd argument | callsThird
Warning: 2nd argument | callsSecond
Warning: options.ctor | callsOption
T: ctor is three frames up | callsDeep
Warning: ctor is the class | constructs
Warning: ctor is an object with a name | named < callsNamed
T: ctor is on no frame | callsAbsent
Warning: ctor is a bound function | callsBound
DeprecationWarning: util.deprecate with a code | user
DeprecationWarning: util.deprecate with no code | user
Warning: limit of 1 | limited
Warning: limit of 1 below ctor | limited
limit of 0 | undefined
Warning: The target port was posted to itself, and the communication channel was lost | posts
TimeoutNaNWarning: NaN is not a number. | setTimeout < timer
Warning: ctor is an async function that is resumed under a tick | async awaitsResumed
Warning: ctor is an async function that is resumed in a turn of its own | async awaitsResumed
*/
