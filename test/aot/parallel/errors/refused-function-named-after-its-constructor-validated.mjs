// An object stands where a function is called for. The message names the object after the function under its `constructor`, which nothing else in the program reads.
// Flags: --aot-validate
function Named() {}
function classIn(error) {
  return /\bNamed\b/.test(String(error)) ? "Named" : String(error);
}
function attempt(label, run) {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, classIn(error));
  }
}
function refusalOf(run) {
  try {
    return run();
  } catch (error) {
    return error.name;
  }
}
function callIt(f) {
  return f();
}
function buildIt(f) {
  return new f();
}
function tagWithIt(f) {
  return f`a`;
}
function testAnInstance(f) {
  return {} instanceof f;
}
function callMember(o) {
  return o.member();
}
function spreadInto(f, list) {
  return f(...list);
}
function callIfThere(f) {
  return f?.();
}
function walk(o) {
  for (const each of o) return each;
}
function* handOn(o) {
  yield* o;
}
async function walkAndWait(o) {
  for await (const each of o) return each;
}
attempt("call", () => callIt({ constructor: Named, a: 1 }));
attempt("construct", () => buildIt({ constructor: Named, b: 1 }));
attempt("template", () => tagWithIt({ constructor: Named, c: 1 }));
attempt("instanceof", () => refusalOf(() => testAnInstance({ constructor: Named, d: 1 })));
attempt("hasInstance", () => refusalOf(() => testAnInstance({ constructor: Named, e: 1, [Symbol.hasInstance]: {} })));
attempt("member", () => callMember({ member: { constructor: Named, f: 1 } }));
attempt("spread", () => spreadInto({ constructor: Named, g: 1 }, [1]));
attempt("optional", () => callIfThere({ constructor: Named, h: 1 }));
attempt("next", () => walk({ [Symbol.iterator]: () => ({ next: { constructor: Named, i: 1 } }) }));
attempt("return", () => walk({ [Symbol.iterator]: () => ({ next: () => ({ done: false }), return: { constructor: Named, j: 1 } }) }));
attempt("yield*", () => [...handOn({ [Symbol.iterator]: () => ({ next: { constructor: Named, k: 1 } }) })]);
attempt("Function.prototype.call", () => Function.prototype.call.call({ constructor: Named, l: 1 }));
attempt("Function.prototype.apply", () => Function.prototype.apply.call({ constructor: Named, m: 1 }));
attempt("on the prototype", () => callIt(Object.create({ constructor: Named, n: 1 })));
await walkAndWait({ [Symbol.asyncIterator]: { constructor: Named, o: 1 } }).catch(error => console.log("async iterator", classIn(error)));
