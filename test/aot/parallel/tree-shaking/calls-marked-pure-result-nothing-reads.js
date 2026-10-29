// /* @__PURE__ */ before a call or a `new` says that it may go if its result is not used. Its arguments still run. A mark in another place, or a result that is used, changes nothing. `bun run` runs every call. `bun build --compile` drops the marked calls whose result is not used, but keeps the one with an argument that has an effect and the one that is assigned to a variable, and drops the marked first call of the chain. Neither knows @__NO_SIDE_EFFECTS__.
// Reference: bun build --compile
const log = [];
function effect(name) { log.push(name); return name; }
function make(name) { log.push("make " + name); return { name }; }
class Made { constructor(name) { log.push("new Made " + name); } }

const unusedCall = /* @__PURE__ */ make("unused call");
const unusedNew = /* @__PURE__ */ new Made("unused new");
const hashForm = /* #__PURE__ */ make("the form with a hash");
const withArgument = /* @__PURE__ */ make(effect("the argument of a marked call"));
const usedResult = /* @__PURE__ */ make("used result");
/* @__PURE__ */ make("a statement of its own");
const member = /* @__PURE__ */ ({ make }).make("a member call");
const notMarked = make("not marked");
const markInside = make(/* @__PURE__ */ "a mark inside the parentheses");
const chained = /* @__PURE__ */ make("the first call of a chain").name.toUpperCase();
let assignedLater;
assignedLater = /* @__PURE__ */ make("assigned to a variable nothing reads");

/* @__NO_SIDE_EFFECTS__ */
function declaredPure(name) { log.push("declaredPure " + name); return name; }
const throughDeclaration = declaredPure("unused result");

console.log(usedResult.name);
console.log(log.join("\n"));
