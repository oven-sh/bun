// Prints, for each way to write a construction, the line and column of its frame in the stack's text and in the call sites that Error.prepareStackTrace gets.
function Thrower() {
  throw new Error("thrown");
}
class Base {
  constructor() {
    throw new Error("thrown");
  }
}
function pass(value) {
  return value;
}
const fail = () => {
  throw new Error("thrown");
};
const holder = { Thrower, inner: { Thrower }, Map, number: 5 };
const forms = {
  withArgument() { new Thrower(1); },
  withoutArgument() { new Thrower(); },
  withoutParentheses() { new Thrower; },
  ofMember() { new holder.Thrower(1); },
  ofMemberWithoutArgument() { new holder.Thrower(); },
  ofInnerMember() { new holder.inner.Thrower(1, 2); },
  ofKey() { new holder["Thrower"](1); },
  ofCallResult() { new (pass(Thrower))(1); },
  ofClass() { new Base(1); },
  ofClassExpression() { new (class { constructor() { fail(); } })(1); },
  ofBoundFunction() { new (Thrower.bind(null, 1))(2); },
  ofProxy() { new (new Proxy(Thrower, {}))(1); },
  withSpread() { new Thrower(...[1, 2]); },
  asArgument() { pass(1, new Thrower(1)); },
  asOperand() { pass(1 + new Thrower(1)); },
  asInitializer() { const made = new Thrower(1); return made; },
  asBaseOfAccess() { return new Thrower(1).member; },
  asBaseOfAccessWithoutArgument() { return new Thrower().member; },
  returned() { return new Thrower(1); },
  thrown() { throw new Thrower(1); },
  overLines() {
    return new
      holder
        .inner
        .Thrower(
          1,
        );
  },
  inner() { new (function Outer() { new Thrower(1); })(2); },
  ofBuiltIn() { new Map(5); },
  ofBuiltInThatCallsBack() { new Map({ [Symbol.iterator]: fail }); },
  ofBuiltInMember() { new holder.Map({ [Symbol.iterator]: fail }); },
  ofBuiltInExecutor() { let caught; new Promise(() => { try { fail(); } catch (error) { caught = error; } }); throw caught; },
  ofHostClass() { new URL("::"); },
  ofNumber() { new holder.number(1); },
  ofNull() { new (pass(null))(1); },
  ofArrow() { new fail(1); },
  ofSymbol() { new Symbol(1); },
  withBadLength() { new Array(-1); },
  byReflect() { Reflect.construct(Thrower, [1]); },
  byReflectAsArgument() { pass(1, Reflect.construct(Thrower, [1], Base)); },
  byReflectOfBuiltIn() { Reflect.construct(Map, [5]); },
  bySuper() { class Derived extends Base { constructor() { super(1); } } new Derived(2); },
  bySuperWithSpread() { class Derived extends Base { constructor(...list) { pass(1); super(...list); } } new Derived(2); },
  byDefaultConstructor() { class Derived extends Base {} new Derived(2); },
  ofThis() { class Maker { static make() { return new this(1); } constructor() { fail(); } } Maker.make(); },
  withFieldThatThrows() { class Fields { field = fail(); } new Fields(1); },
  ownError() { class Problem extends Error {} throw new Problem("thrown"); },
  capturedInConstructor() { function Captures() { Error.captureStackTrace(this); } throw new Captures(1); },
  ofVariableDeclaredBelow() { new below(1); let below = Thrower; },
  ofClassDeclaredBelow() { new Below(1); class Below {} },
  ofVariableDeclaredBelowAsArgument() { pass(1, new below(pass(1))); const below = Thrower; },
  asObjectOfForIn() { for (const key in new Proxy({}, { ownKeys: fail })) pass(key); },
  asObjectOfForOf() { for (const item of new Proxy([], { get: fail })) pass(item); },
  asOperandOfSpread() { pass(...new Proxy([], { get: fail })); },
};
const inThisFile = /call-sites-of-expressions-that-construct/;
function textOf(error) {
  return String(error.stack).split("\n").filter(line => inThisFile.test(line)).map(line => /:(\d+:\d+)\)?$/.exec(line)[1]);
}
for (const [name, form] of Object.entries(forms)) {
  let text, sites;
  try { form(); } catch (error) { text = textOf(error); }
  Error.prepareStackTrace = (error, list) => list.filter(site => inThisFile.test(site.getFileName() ?? "")).map(site => site.getLineNumber() + ":" + site.getColumnNumber());
  try { form(); } catch (error) { sites = error.stack; }
  Error.prepareStackTrace = undefined;
  console.log(name, "| text", text.slice(0, -1).join(" "), "| sites", sites.slice(0, -1).join(" "));
}
(async function () {
  async function later() { await 1; return new Thrower(1); }
  async function waits() { return pass(await later()); }
  Error.prepareStackTrace = (error, list) => list.filter(site => inThisFile.test(site.getFileName() ?? "")).map(site => site.getLineNumber() + ":" + site.getColumnNumber());
  try { await waits(); } catch (error) { console.log("behindAnAwait | sites", error.stack.join(" ")); }
  Error.prepareStackTrace = undefined;
})();
