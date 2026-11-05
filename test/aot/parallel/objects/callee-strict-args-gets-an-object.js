// `callee` of strict arguments is an accessor whose getter and setter are one native function that throws. Each line passes it an object of the program, as the stored value or as the receiver.
// Env of the executable: BUN_JSC_validateAOTRuntime=1
function tell(run) { try { run(); console.log("no error"); } catch (error) { console.log(error.constructor.name); } }
function Stored() { this.f = 1; arguments.callee = this; }
function Keyed(key) { this.f = 1; arguments[key] = this; }
function Aliased() { this.f = 1; const list = arguments; list.callee = this; }
function Assigned() { this.f = 1; Object.assign(arguments, { callee: this }); }
function Reflected() { this.f = 1; Reflect.set(arguments, "callee", this); }
function Pattern() { this.f = 1; [arguments.callee] = [this]; }
function Compound() { this.f = 1; arguments.callee ??= this; }
function heirStores() { const heir = Object.create(arguments); heir.f = 1; heir.callee = { g: 2 }; }
function heirReads() { const heir = { __proto__: arguments, f: 1 }; return heir.callee; }
function receiverReads() { return Reflect.get(arguments, "callee", { f: 1 }); }
function receiverStores() { return Reflect.set(arguments, "callee", { g: 2 }, { f: 1 }); }
tell(() => new Stored());
tell(() => new Keyed("callee"));
tell(() => new Aliased());
tell(() => new Assigned());
tell(() => new Reflected());
tell(() => new Pattern());
tell(() => new Compound());
tell(heirStores);
tell(heirReads);
tell(receiverReads);
tell(receiverStores);

function order() { let x = 1; try { x = 2; arguments.callee = { a: 1 }; x = 3; } catch (error) { return x + " " + error.constructor.name; } return x; }
function kept() { const o = { a: 1, b: 2 }; try { arguments.callee = o; } catch {} return o.a + o.b + Object.keys(o).length; }
function index(key, value) { arguments[key] = value; return arguments[0] + "|" + arguments[1] + "|" + arguments.length; }
console.log(order(), kept(), index(0, "x"), index(1, "y"), index("length", 7));
