// JSON.parse without a written type: the run time's own parser makes the second object of a form a cell of a layout of the program, where one has every name. Whatever the text holds, the answer is what JSON.parse gives:
// other orders of the keys, members left out, members that no layout has, a member twice, values of other types, records in records and in lists, `__proto__`, indexes, names of Object.prototype, escapes, odd numbers,
// bad texts; and what is done to the object afterwards: a store of another type, a new name, delete, freeze, an accessor, another prototype
// Under: --aot-testing=ForceStraightCompilation: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function make(port, host) { return { port, host }; }
function pair(id, name, tags) { return { id, name, tags }; }
function load(text) { return JSON.parse(text); }
function describe(c) { return c === null ? "null" : typeof c !== "object" ? typeof c + ":" + String(c) : JSON.stringify(c) + " keys=" + Object.keys(c).join() + " own=" + Reflect.ownKeys(c).map(String).join() + " plain=" + (Object.getPrototypeOf(c) === Object.prototype || Array.isArray(c)); }
function tell(f) { try { report(f()); } catch (e) { report(e.name); } }
function thrice(text) { for (let turn = 0;turn < 3; turn++) tell(() => describe(load(text))); }
report(make(1, "made"));
report(pair(1, "made", ["t"]));
thrice('{"port":1,"host":"a"}');
thrice('{"host":"b","port":2}');
thrice(' { "port" : 3 , "host" : "c" } ');
thrice('{"port":4}');
thrice('{"host":"d"}');
thrice("{}");
thrice('{"port":5,"host":"e","more":true}');
thrice('{"more":true,"port":6,"host":"f"}');
thrice('{"port":7,"port":8,"host":"g"}');
thrice('{"port":"text","host":9}');
thrice('{"port":null,"host":null}');
thrice('{"port":{"port":10,"host":"inner"},"host":[{"port":11,"host":"in a list"},{"port":12,"host":"in a list"}]}');
thrice('{"__proto__":{"port":13},"host":"h"}');
thrice('{"port":14,"__proto__":null,"host":"i"}');
thrice('{"port":15,"host":"j","0":"zero"}');
thrice('{"1":"one","port":16,"host":"k","0":"zero"}');
thrice('{"port":17,"host":"l","constructor":1,"toString":2}');
thrice('{"\\u0070ort":18,"host":"m"}');
thrice('{"port":-0,"host":"n"}');
thrice('{"port":1e999,"host":"o"}');
thrice('{"port":9007199254740993,"host":"p"}');
thrice('{"port":1.5,"host":"\\ud800"}');
thrice('{"id":1,"name":"q","tags":["x","y"]}');
thrice('{"id":2,"name":"r","tags":null}');
thrice('{"tags":[],"name":"s","id":3}');
thrice('[{"port":19,"host":"t"},{"port":20,"host":"u"},{"host":"v","port":21},{"port":22}]');
thrice('{"port":23,"host":"w",}');
thrice('{"port":24,"host":"x"} y');
thrice('{"port":25,"host":"z"');
tell(() => { load('{"port":26,"host":"a"}'); const c = load('{"port":26,"host":"a"}'); c.port = "text"; c.late = 1; delete c.host; c.host = "again"; return describe(c); });
tell(() => { load('{"port":27,"host":"b"}'); const c = load('{"port":27,"host":"b"}'); Object.freeze(c); try { c.port = 1; } catch { return "refused " + describe(c); } return describe(c); });
tell(() => { load('{"port":28,"host":"c"}'); const c = load('{"port":28,"host":"c"}'); Object.defineProperty(c, "port", { get() { return "got"; }, enumerable: false }); return describe(c) + c.port; });
tell(() => { load('{"port":29,"host":"d"}'); const c = load('{"port":29,"host":"d"}'); Object.setPrototypeOf(c, { above: 1 }); return describe(c) + c.above; });
tell(() => { const a = load('{"port":30,"host":"e"}'); const b = load('{"port":30,"host":"e"}'); const c = load('{"port":30,"host":"e"}'); return a !== b && b !== c; });
tell(() => { let sum = 0; for (let i = 0;i < 300; i++) sum += load('{"port":' + i + ',"host":"loop"}').port; return sum; });
tell(() => { const made = make(31, "f"); const parsed = (load('{"port":31,"host":"f"}'), load('{"port":31,"host":"f"}')); return JSON.stringify(made) === JSON.stringify(parsed) && made !== parsed; });
report("end");
