// What a catch clause receives: errors of the run time arrive beside the values the program throws.
class Fail { constructor(code) { this.code = code; } describe() { return "fail" + this.code; } }
function report(e) { return [typeof e, e instanceof Fail, e && e.code, e && e.name, e && typeof e.describe].join(" "); }
function guard(name, f) { try { if (name === "never") throw new Fail(1); f(); console.log(name, "no throw"); } catch (e) { console.log(name, report(e)); } }
function deep(n) { return deep(n + 1) + 1; }
guard("own", () => { throw new Fail(2); });
guard("overflow", () => deep(0));
guard("null read", () => null.x); guard("undefined call", () => undefined()); guard("not a function", () => ({}).m());

guard("array length", () => new Array(-1)); guard("repeat", () => "a".repeat(-1)); guard("to fixed", () => (1).toFixed(101));
guard("bigint mix", () => 1n + 1); guard("bigint div", () => 1n / 0n); guard("symbol", () => Symbol() + "");
guard("json", () => JSON.parse("{")); guard("cyclic", () => { const o = {}; o.o = o; JSON.stringify(o); });
guard("uri", () => decodeURIComponent("%")); guard("regexp", () => new RegExp("(")); guard("in", () => "k" in 5); guard("instanceof", () => ({}) instanceof 5);
guard("no super", () => new (class extends Fail { constructor() { this.x = 1; } })());
guard("super twice", () => new (class extends Fail { constructor() { super(1); super(2); } })());
guard("class call", () => Fail()); guard("new arrow", () => new (() => {})());
guard("running generator", () => { const g = (function* () { g.next(); })(); g.next(); });
guard("primitive", () => { throw 5; }); guard("undefined", () => { throw undefined; }); guard("null", () => { throw null; }); guard("string", () => { throw "s"; });
guard("getter", () => ({ get g() { throw { code: "lit" }; } }).g); guard("to primitive", () => +{ valueOf() { throw new Fail(3); } });
guard("iterator", () => { for (const v of 5); }); guard("spread", () => [...undefined]); guard("destructure", () => { const { a } = null; });
guard("proxy", () => new Proxy({}, { get() { throw new Fail(4); } }).x); guard("revoked", () => { const r = Proxy.revocable({}, {}); r.revoke(); r.proxy.x; });
guard("frozen", () => { "use strict"; Object.freeze({ a: 1 }).a = 2; }); guard("define", () => Object.defineProperty(Object.freeze({}), "a", { value: 1 }));
guard("host", () => require("node:fs").readFileSync("/nonexistent/file")); guard("url", () => new URL("::")); guard("atob", () => atob("*"));
guard("typed array", () => new Uint8Array(-1)); guard("detached", () => { const b = new ArrayBuffer(8); structuredClone(b, { transfer: [b] }); new Uint8Array(b); });
guard("set proto cycle", () => { const a = {}, b = Object.create(a); Object.setPrototypeOf(a, b); });
guard("finally", () => { try { throw new Fail(5); } finally { null.x; } });
guard("rethrow", () => { try { null.x; } catch (e) { throw e; } });
guard("callback", () => [1].map(() => { throw new Fail(6); })); guard("sort", () => [2, 1].sort(() => { throw 7; }));
async function viaAwait() { try { await Promise.reject(new Fail(8)); } catch (e) { console.log("await", report(e)); } try { await { then() { null.x; } }; } catch (e) { console.log("thenable", report(e)); } try { await (async () => deep(0))(); } catch (e) { console.log("async overflow", report(e)); } }
viaAwait();
function onlyOwn() { try { throw new Fail(9); } catch (e) { return e.describe(); } } console.log(onlyOwn());
function nested(n) { try { if (n > 2) throw new Fail(n); return nested(n + 1); } catch (e) { if (n) throw e; return e.describe(); } } console.log(nested(0));
function overflowInHandler() { let depth = 0; function f() { depth++; try { f(); } catch (e) { return e instanceof RangeError; } return true; } return f(); } console.log(overflowInHandler());
