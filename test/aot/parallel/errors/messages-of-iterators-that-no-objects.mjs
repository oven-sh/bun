// The engine rewrites some messages around the text of the failing expression. A compiled program has the message from before that step.
function withoutSourceText(message) {
  return message
    .replace(/^(.*) is not a function\. \(In '.*', '.*' is (an instance of )?(.*)\)$/s, "$3 is not a function")
    .replace(/ \((evaluating|near) '.*'\)$/s, "")
    .replace(/^Symbol\(.*\) is not a function$/s, "a Symbol is not a function")
    .replace(/^.* is not an Object\.$/s, "(operand) is not an Object.")
    .replace(/^.*( is not a function\.|  is not a function)$/s, "(operand) is not a function.")
    .replace(/^.*\[Symbol\.hasInstance\] is not a function, undefined, or null\.?$/s, "(operand)[Symbol.hasInstance] is not a function, undefined, or null.")
    .replace(/^.* is not an object or null$/s, "The value of the superclass's prototype property is not an object or null.");
}

function attempt(label, run) {
  try {
    console.log(label, "->", String(run()));
  } catch (error) {
    console.log(label, "threw", error?.constructor?.name, withoutSourceText(String(error?.message)));
  }
}

const opaque = value => [value, 0][Number(process.argv.length > 100)];
const returnsNumber = opaque({ [Symbol.iterator]() { return 5; } });
const methodIsNumber = opaque({ [Symbol.iterator]: 5 });

attempt("for of, iterator returns 5", () => { for (const x of returnsNumber) break; return "done"; });
attempt("[a] =, iterator returns 5", () => { const [a] = returnsNumber; return "done"; });
attempt("[...], iterator returns 5", () => [...returnsNumber].length);
attempt("f(...), iterator returns 5", () => Math.max(...returnsNumber));
attempt("yield*, iterator returns 5", () => { for (const x of (function* () { yield* returnsNumber; })()) break; return "done"; });
attempt("yield*, iterator 5", () => { for (const x of (function* () { yield* methodIsNumber; })()) break; return "done"; });
