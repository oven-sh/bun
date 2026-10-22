// A class that is called and a function without [[Construct]] that is constructed throw before any code of theirs runs, so the set of callees of such a call is empty and still complete.
class Fail { constructor(code) { this.code = code; } }
function plain() { return 1; }
function call(f) { try { return f(); } catch (e) { return e.name; } }
function make(f) { try { return typeof new f(); } catch (e) { return e.name; } }
try { Fail(); } catch (e) { console.log("class call", e.name); }
try { new (() => {})(); } catch (e) { console.log("new arrow", e.name); }
console.log(call(Fail), call(plain), call(() => 2));
console.log(make(Fail), make(plain), make(() => 2), make(async function () {}), make(function* () {}), make({ m() {} }.m));
console.log(call(class extends Fail {}), make(class extends Fail {}), make(Object.getOwnPropertyDescriptor({ get g() { return 1; } }, "g").get));
