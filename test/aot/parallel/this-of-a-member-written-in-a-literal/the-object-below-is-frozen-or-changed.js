// Under: --aot-testing=CheckProofsAtRunTime: what is proven is asked again at run time
// Under: --aot-testing=FailSpeculations: every guess fails
"use strict";
const proto = { set body(value) { this._body = value; }, get body() { return this._body; } };
globalThis.madeUpProto = proto;
function tryTo(deed) { try { return deed(); } catch (error) { return error.name; } }
const frozen = Object.freeze(Object.create(proto));
const hidden = Object.create(proto);
Object.defineProperty(hidden, "_body", { get() { return "by a getter " + process.argv.length; }, set(value) {} });
hidden.body = 5;
console.log(tryTo(() => { frozen.body = 1; }), frozen.body, hidden.body.replace(String(process.argv.length), "n"));
