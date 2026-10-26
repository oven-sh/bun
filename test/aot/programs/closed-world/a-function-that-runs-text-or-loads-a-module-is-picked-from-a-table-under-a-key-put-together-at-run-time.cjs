// Each table holds a function that runs text or loads a module beside a function of the program. A function reads the table under a key that is put together at run time, and what it returns is called: once the key picks the function of the program, once the other.
const report = (what, call) => {
  try {
    console.log(what + ":", call());
  } catch (error) {
    console.log(what + ":", error.name, error.code);
  }
};
const first = names => names.split(" ")[0];

const evaluators = { run: eval, other: text => text.length };
const pickEvaluator = name => evaluators[name];
report("a function beside eval", () => pickEvaluator(first("other run"))("1 + 1"));
report("eval", () => pickEvaluator(first("run other"))("1 + 1"));

const makers = { make: Function, other: text => () => text.length };
const pickMaker = name => makers[name];
report("a function beside Function", () => pickMaker(first("other make"))("return 2")());
report("Function", () => pickMaker(first("make other"))("return 2")());

const loaders = { load: require, other: name => ({ Socket: name }) };
const pickLoader = name => loaders[name];
report("a function beside require", () => typeof pickLoader(first("other load"))(first("node:net x")).Socket);
report("require", () => typeof pickLoader(first("load other"))(first("node:net x")).Socket);

const finders = { find: process.getBuiltinModule, other: name => ({ Socket: name }) };
const pickFinder = name => finders[name];
report(
  "a function beside process.getBuiltinModule",
  () => typeof pickFinder(first("other find"))(first("node:net x")).Socket,
);
report("process.getBuiltinModule", () => typeof pickFinder(first("find other"))(first("node:net x")).Socket);
