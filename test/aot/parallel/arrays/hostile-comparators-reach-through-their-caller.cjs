// A sloppy comparator walks to its caller and to the caller's arguments, where a list of sort() would lie if anything could hand it out.
function objects(length) {
  const list = [];
  for (let i = 0; i < length; i++) list.push({ rank: (i * 37) % 11, order: i });
  return list;
}
function describe(fn) {
  try {
    return fn === null ? "null" : typeof fn === "function" ? `function ${fn.name}` : typeof fn;
  } catch (error) {
    return error.constructor.name;
  }
}
function attempt(run) {
  try {
    return run();
  } catch (error) {
    return `${error.constructor.name}: ${error.message}`;
  }
}
for (const length of [3, 9, 70]) {
  const seen = new Set();
  let reachedLists = 0;
  const list = objects(length);
  list.sort(function compare(a, b) {
    seen.add(attempt(() => describe(compare.caller)));
    seen.add(attempt(() => describe(arguments.callee === compare)));
    attempt(() => {
      for (let caller = compare.caller, depth = 0; caller && depth < 8; caller = caller.caller, depth++) {
        const handed = caller.arguments;
        if (!handed) continue;
        for (let i = 0; i < handed.length; i++) {
          if (Array.isArray(handed[i])) {
            reachedLists++;
            handed[i].length = 0;
          }
        }
      }
    });
    return a.rank - b.rank;
  });
  console.log(length, [...seen].join(" | "), reachedLists, list.length);
}
function sortsInside(list) {
  return list.sort(function inner(a, b) {
    const outer = inner.caller;
    if (outer && outer.arguments && outer.arguments[0] === list) list.length = 1;
    return a.rank - b.rank;
  });
}
console.log(attempt(() => sortsInside(objects(20)).length));
