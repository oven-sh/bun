// The source of a function keeps the names of parameters that no argument is passed for, and of variables without a value. Evaluated elsewhere they mean something else.
globalThis.given = "from the global object";
const kept = [];
(function (window, undefined, given) {
  kept.push(() => [typeof window, typeof given, given === void 0].join());
  kept.push(() => given.length);
  kept.push(() => given("x"));
  kept.push(() => ({ given }).given);
  kept.push(() => given ? "given" : "nothing");
  kept.push(() => !given);
  kept.push(() => `${given} ${undefined}`);
  kept.push(function named() { return given; });
  kept.push(() => class { static given = given; [given]() { return given; } }.given);
})(globalThis);
((first, given, ...rest) => kept.push(() => [first, given, rest.length].join()))(1);
(function () { var given; { var later; } kept.push(() => given, () => given === later, () => typeof later); })();
const show = run => { try { return String(run()); } catch (error) { return error.name + ": " + error.message.split("\n")[0]; } };
for (const f of kept) console.log([String(f).replace(/\s+/g, " ").replace(/; }/g, " }"), show(f), show(() => (0, eval)("(" + f + ")")())].join(" | "));
