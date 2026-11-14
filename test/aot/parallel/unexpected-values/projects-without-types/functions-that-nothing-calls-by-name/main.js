import { EventEmitter } from "node:events";
import * as library from "./library.js";
import App from "./methods.cjs";
import { attempt, show } from "./show.js";

console.log("this file is strict:", (function () {
  return this === undefined;
})());

const decoded = text => Buffer.from(text, "hex").toString();
attempt("by a computed name", () => library[decoded("627941436f6d70757465644e616d65")]());
attempt("by evaluated text", () => eval("library.byEvaluatedText()"));
attempt("by a function made of text", () => new Function("library", "return library.byAFunctionMadeOfText()")(library));
globalThis.hookOfTheProgram = library.throughTheGlobalObject;
attempt("through the global object", () => globalThis[decoded("686f6f6b4f6654686550726f6772616d")]());
delete globalThis.hookOfTheProgram;
attempt("by map", () => [0].map(library.byMap));
attempt("by sort", () => ([2, 1].sort(library.bySort), library.ran.splice(0, 1)));
attempt("by replace", () => "x".replace("x", library.byReplace));
attempt("as a getter", () => Object.defineProperty({}, "read", { get: library.asAGetter })[decoded("72656164")]);
attempt("as a setter", () => {
  const seen = [];
  const holder = Object.defineProperty({}, "stored", { set: value => seen.push(library.asASetter(value)) });
  holder.stored = 1;
  return seen;
});
attempt("as valueOf", () => ({ valueOf: library.asValueOf }) + "");
attempt("as toString", () => `${{ toString: library.asToString }}`);
attempt("as Symbol.toPrimitive", () => ({ [Symbol.toPrimitive]: library.asToPrimitive }) + "");
attempt("as toJSON", () => JSON.stringify({ toJSON: library.asToJSON }));
attempt("as an iterator", () => [...{ [Symbol.iterator]: library.asAnIterator }]);
attempt("as Symbol.hasInstance", () => 1 instanceof { [Symbol.hasInstance]: library.asHasInstance });
attempt("as a trap", () => new Proxy({}, { get: library.asATrap }).anything);
attempt("as a reviver", () => JSON.parse("1", library.asAReviver));
attempt("as a listener", () => {
  const seen = [];
  const emitter = new EventEmitter();
  emitter.on("event", () => seen.push(library.asAListener()));
  emitter.emit("event");
  return seen;
});
attempt("as a tag", () => library.asATag``);
attempt("as a default", () => ((value = library.asADefault()) => value)());
attempt("by call", () => library.byCall.call(null));
attempt("by apply", () => library.byApply.apply(null, []));
attempt("by bind", () => library.byBind.bind(null)());
attempt("by Reflect.apply", () => Reflect.apply(library.byReflectApply, null, []));
attempt("by call of call", () => Function.prototype.call.call(library.byCallOfCall, null));
attempt("as a constructor", () => new library[decoded("617341436f6e7374727563746f72")]().said);
attempt("by Reflect.construct", () => Reflect.construct(library.byReflectConstruct, []).said);

const app = new App();
attempt("methods stored under computed names", () => app.get("/a").post("/b").remove("/c").describe());
attempt("more of them", () => [app.count(), app.first]);

console.log("as then", show(await { then: library.asThen }));
console.log("by a reaction", show(await Promise.resolve().then(library.byAReaction)));
console.log("by a timer", show(await new Promise(resolve => setTimeout(() => resolve(library.byATimer()), 0))));
console.log("by a tick", show(await new Promise(resolve => process.nextTick(() => resolve(library.byATick())))));
console.log("by a microtask", show(await new Promise(resolve => queueMicrotask(() => resolve(library.byAMicrotask())))));
process.on("exit", () => console.log("at exit", show(library.atExit())));
