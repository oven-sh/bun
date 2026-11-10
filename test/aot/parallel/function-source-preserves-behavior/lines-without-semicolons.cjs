// `true && [1].map(g)` reads `[1].map(g)` in what `toString()` gives. The line in front has no semicolon, and must not go on in it.
const same = (x) => x;
const five = () => 5;
const cases = {
  aList: [function (a, g) { let b = a
    true && [1].map(g)
    return b === a; }, [0, [5]], same],
  parentheses: [function (a) { let b = a
    true && (0, a)
    return typeof b; }, five],
  aFunction: [function (a) { let n = 0; let b = a
    true && function () { n = 1; }()
    return n + typeof b; }, five],
  aClass: [function (a) { let b = a
    true && class {}.name
    return typeof b; }, five],
  anObject: [function (a) { let b = a
    true && { x: 1 }.x
    return typeof b; }, five],
  aTemplate: [function (a) { let b = a
    true && `t`.length
    return typeof b; }, five],
  signs: [function (a, c) { let b = a
    true && -c
    let d = a
    false || +c
    return b + "," + d; }, 10, 3],
  aRegularExpression: [function (a, g, i) { let b = a
    true && /x/g.test(i)
    return b; }, 12, 2, 3],
  otherOperators: [function (a, g) { let b = a
    true ? [1].map(g) : 0
    let c = a
    null ?? [1].map(g)
    let d = a
    true && (true ? [1].map(g) : 0)
    return [b === a, c === a, d === a]; }, [0, [5]], same],
  behindAnObject: [function (g) { let b = {}
    true && [1].map(g)
    return typeof b; }, same],
  behindAComment: [function (a, g) { let b = a // the end;
    true && [1].map(g)
    let c = a /* the end; */
    true && [1].map(g)
    return [b === a, c === a]; }, [0, [5]], same],
  behindADirective: [function (g) { "a directive"
    true && [1].map(g)
    return "it ran"; }, same],
  inAClause: [function (a, g) { let b; switch (a) { case 1: b = g
    true && [0].map(g)
    break; } return b === g; }, 1, same],
  asTheBodyOfAnIf: [function (a) { let r = 0; if (a) true && [1].map(() => { r = 1; }); else false || [1].map(() => { r = 2; }); return r; }, 0],
  asTheBodyOfALoop: [function () { let r = 0; for (const x of [1, 2]) true && [x].map((y) => { r += y; }); do true && [1].map(() => { r++; }); while (r < 5); return r; }],
  behindReturn: [function (a) { return true &&
    a; }, 4],
};
const show = (run) => {
  try {
    return JSON.stringify(run()) ?? "undefined";
  } catch (error) {
    return error.constructor.name;
  }
};
for (const [name, [f, ...given]] of Object.entries(cases)) {
  const again = new Function("return (" + String(f) + "\n)")();
  console.log(name + ": " + show(() => f(...given)) + " | " + show(() => again(...given)));
}
