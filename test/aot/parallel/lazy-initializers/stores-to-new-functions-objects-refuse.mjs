// A store to a function that was just made is refused where an object above it has the name and does not let it be written: `constructor` above an async function or a generator function, Symbol.hasInstance above every function. The TypeError comes where the store stands, not at the first read of what the statement made, and not never.
const log = [];
function attempt(label, run) {
  try {
    const held = run();
    log.push(label + ": no error, " + typeof held());
  } catch (error) {
    log.push(label + ": " + error.name + " after " + steps.join(","));
  }
  steps.length = 0;
}
const steps = [];

function asyncConstructor() { const made = async function () {}.constructor = 2; }
function generatorConstructor() { const made = function* () {}.constructor = 2; }
function asyncGeneratorConstructor() { const made = async function* () {}.constructor = 2; }
function asyncArrowConstructor() { const made = (async () => {}).constructor = 2; }
function plainConstructor() { const made = function () {}.constructor = 2; }
function arrowConstructor() { const made = (() => {}).constructor = 2; }
function plainHasInstance() { const made = function () {}[Symbol.hasInstance] = 2; }
function asyncToStringTag() { const made = async function () {}[Symbol.toStringTag] = 2; }
function generatorToStringTag() { const made = function* () {}[Symbol.toStringTag] = 2; }
function plainToStringTag() { const made = function () {}[Symbol.toStringTag] = 2; }
function generatorPrototype() { const made = function* () {}.prototype = 2; }
function asyncPrototype() { const made = async function () {}.prototype = 2; }
function asyncOtherName() { const made = async function () {}.other = 2; }
function asyncToString() { const made = async function () {}.toString = 2; }
function asyncName() { const made = async function () {}.name = 2; }
function asyncDefinition() { const made = Object.defineProperty(async function () {}, "constructor", { value: 2 }); return made; }

for (const [label, make] of Object.entries({
  asyncConstructor, generatorConstructor, asyncGeneratorConstructor, asyncArrowConstructor, plainConstructor, arrowConstructor, plainHasInstance, asyncToStringTag,
  generatorToStringTag, plainToStringTag, generatorPrototype, asyncPrototype, asyncOtherName, asyncToString, asyncName, asyncDefinition,
})) {
  attempt(label + " by a table", () => { const result = make(); steps.push("behind the call"); return () => result; });
}

attempt("asyncConstructor", () => { const result = asyncConstructor(); steps.push("behind the call"); return () => result; });
attempt("generatorConstructor", () => { const result = generatorConstructor(); steps.push("behind the call"); return () => result; });
attempt("asyncGeneratorConstructor", () => { const result = asyncGeneratorConstructor(); steps.push("behind the call"); return () => result; });
attempt("asyncArrowConstructor", () => { const result = asyncArrowConstructor(); steps.push("behind the call"); return () => result; });
attempt("plainConstructor", () => { const result = plainConstructor(); steps.push("behind the call"); return () => result; });
attempt("arrowConstructor", () => { const result = arrowConstructor(); steps.push("behind the call"); return () => result; });
attempt("plainHasInstance", () => { const result = plainHasInstance(); steps.push("behind the call"); return () => result; });
attempt("asyncToStringTag", () => { const result = asyncToStringTag(); steps.push("behind the call"); return () => result; });
attempt("generatorToStringTag", () => { const result = generatorToStringTag(); steps.push("behind the call"); return () => result; });
attempt("plainToStringTag", () => { const result = plainToStringTag(); steps.push("behind the call"); return () => result; });
attempt("generatorPrototype", () => { const result = generatorPrototype(); steps.push("behind the call"); return () => result; });
attempt("asyncPrototype", () => { const result = asyncPrototype(); steps.push("behind the call"); return () => result; });
attempt("asyncOtherName", () => { const result = asyncOtherName(); steps.push("behind the call"); return () => result; });
attempt("asyncToString", () => { const result = asyncToString(); steps.push("behind the call"); return () => result; });
attempt("asyncName", () => { const result = asyncName(); steps.push("behind the call"); return () => result; });
attempt("asyncDefinition", () => { const result = asyncDefinition(); steps.push("behind the call"); return () => result; });

function once() {
  const result = asyncConstructor();
  log.push("once went on behind the call");
  return () => result;
}
try { once(); } catch (error) { log.push("once: " + error.name); }

function onceForAGenerator() {
  const result = generatorConstructor();
  log.push("onceForAGenerator went on behind the call");
  const read = () => { try { return result.constructor; } catch (error) { return "the read threw " + error.name; } };
  return read();
}
try { log.push(String(onceForAGenerator())); } catch (error) { log.push("onceForAGenerator: " + error.name); }

function onceUnderASymbol() {
  const result = plainHasInstance();
  log.push("onceUnderASymbol went on behind the call");
  return () => result;
}
try { onceUnderASymbol(); } catch (error) { log.push("onceUnderASymbol: " + error.name); }

console.log(log.join("\n"));
