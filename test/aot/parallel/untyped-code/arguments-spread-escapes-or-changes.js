// `f(...arguments)` and `f(...rest)`: the array escapes on one path only, changes while the callee runs, crosses a suspension, or is used in classes, accessors and callbacks from native code.
const H = globalThis;
const one = v => Object.is(v, -0) ? "-0" : v === undefined ? "undefined" : typeof v === "function" ? "fn" : typeof v === "symbol" ? "symbol" : typeof v === "string" ? JSON.stringify(v) : v !== null && typeof v === "object" ? (Array.isArray(v) ? "[" + Array.from(v, one).join() + "]" : Object.prototype.toString.call(v) === "[object Arguments]" ? "A(" + Array.prototype.map.call(v, one).join() + ")" : "{" + Object.keys(v).map(k => k + ":" + one(v[k])).join() + "}") : String(v);
const S = a => a === undefined || a === null || typeof a !== "object" ? one(a) : Array.isArray(a) ? a.length + one(a) : one(a);
function say(name, f) { let r; try { r = S(f()); } catch (e) { r = "threw " + e.name; } console.log(name + ": " + r); }
H.id = function (...a) { return a; }; H.K = class { constructor(...a) { this.a = a; } };
H.change = function (x) { x[0] = "changed"; }; H.thrower = function () { throw "thrown"; }; H.nothing = function () {};

function escapeOnOnePath_lit(c) { if (c === "x") { H.keep = arguments; return S(H.keep); } return [0, ...arguments]; }
function escapeOnOnePath_copy(c) { if (c === "x") { H.keep = arguments; return S(H.keep); } return [...arguments]; }
function escapeOnOnePath_call(c) { if (c === "x") { H.keep = arguments; return S(H.keep); } return H.id(0, ...arguments); }
function escapeOnOnePath_new(c) { if (c === "x") { H.keep = arguments; return S(H.keep); } return new H.K(0, ...arguments).a; }
function escapeOnOnePath_seen(c) { if (c === "x") { H.keep = arguments; return S(H.keep); } return H.id(...arguments); }
function spreadThenEscape_lit(c) { const r = [0, ...arguments]; if (c) H.keep = arguments; return S(r) + S(c ? H.keep : 0); }
function spreadThenEscape_copy(c) { const r = [...arguments]; if (c) H.keep = arguments; return S(r) + S(c ? H.keep : 0); }
function spreadThenEscape_call(c) { const r = H.id(0, ...arguments); if (c) H.keep = arguments; return S(r) + S(c ? H.keep : 0); }
function spreadThenEscape_new(c) { const r = new H.K(0, ...arguments).a; if (c) H.keep = arguments; return S(r) + S(c ? H.keep : 0); }
function spreadThenEscape_seen(c) { const r = H.id(...arguments); if (c) H.keep = arguments; return S(r) + S(c ? H.keep : 0); }
function spreadThenEscapeThenChange_lit() { const r = [0, ...arguments]; H.change(arguments); return S(r); }
function spreadThenEscapeThenChange_copy() { const r = [...arguments]; H.change(arguments); return S(r); }
function spreadThenEscapeThenChange_call() { const r = H.id(0, ...arguments); H.change(arguments); return S(r); }
function spreadThenEscapeThenChange_new() { const r = new H.K(0, ...arguments).a; H.change(arguments); return S(r); }
function spreadThenEscapeThenChange_seen() { const r = H.id(...arguments); H.change(arguments); return S(r); }
function escapeThenSpread_lit() { H.change(arguments); return [0, ...arguments]; }
function escapeThenSpread_copy() { H.change(arguments); return [...arguments]; }
function escapeThenSpread_call() { H.change(arguments); return H.id(0, ...arguments); }
function escapeThenSpread_new() { H.change(arguments); return new H.K(0, ...arguments).a; }
function escapeThenSpread_seen() { H.change(arguments); return H.id(...arguments); }
function escapeInCondition_lit(c) { if (c) H.change(arguments); return [0, ...arguments]; }
function escapeInCondition_copy(c) { if (c) H.change(arguments); return [...arguments]; }
function escapeInCondition_call(c) { if (c) H.change(arguments); return H.id(0, ...arguments); }
function escapeInCondition_new(c) { if (c) H.change(arguments); return new H.K(0, ...arguments).a; }
function escapeInCondition_seen(c) { if (c) H.change(arguments); return H.id(...arguments); }
function storeInCondition_lit(c) { c && (arguments[1] = "s"); return [0, ...arguments]; }
function storeInCondition_copy(c) { c && (arguments[1] = "s"); return [...arguments]; }
function storeInCondition_call(c) { c && (arguments[1] = "s"); return H.id(0, ...arguments); }
function storeInCondition_new(c) { c && (arguments[1] = "s"); return new H.K(0, ...arguments).a; }
function storeInCondition_seen(c) { c && (arguments[1] = "s"); return H.id(...arguments); }
function loopOfSpreads_lit() { const out = []; for (let i = 0; i < 3; i++) out.push(S([0, ...arguments])); return out.join("/"); }
function loopOfSpreads_copy() { const out = []; for (let i = 0; i < 3; i++) out.push(S([...arguments])); return out.join("/"); }
function loopOfSpreads_call() { const out = []; for (let i = 0; i < 3; i++) out.push(S(H.id(0, ...arguments))); return out.join("/"); }
function loopOfSpreads_new() { const out = []; for (let i = 0; i < 3; i++) out.push(S(new H.K(0, ...arguments).a)); return out.join("/"); }
function loopOfSpreads_seen() { const out = []; for (let i = 0; i < 3; i++) out.push(S(H.id(...arguments))); return out.join("/"); }
function loopSpreadAndEscape_lit() { const out = []; for (let i = 0; i < 3; i++) { out.push(S([0, ...arguments])); arguments[0] = i; } return out.join("/"); }
function loopSpreadAndEscape_copy() { const out = []; for (let i = 0; i < 3; i++) { out.push(S([...arguments])); arguments[0] = i; } return out.join("/"); }
function loopSpreadAndEscape_call() { const out = []; for (let i = 0; i < 3; i++) { out.push(S(H.id(0, ...arguments))); arguments[0] = i; } return out.join("/"); }
function loopSpreadAndEscape_new() { const out = []; for (let i = 0; i < 3; i++) { out.push(S(new H.K(0, ...arguments).a)); arguments[0] = i; } return out.join("/"); }
function loopSpreadAndEscape_seen() { const out = []; for (let i = 0; i < 3; i++) { out.push(S(H.id(...arguments))); arguments[0] = i; } return out.join("/"); }
function loopEscapeAtLast_lit() { let r; for (let i = 0; i < 3; i++) { r = [0, ...arguments]; if (i === 1) H.change(arguments); } return S(r); }
function loopEscapeAtLast_copy() { let r; for (let i = 0; i < 3; i++) { r = [...arguments]; if (i === 1) H.change(arguments); } return S(r); }
function loopEscapeAtLast_call() { let r; for (let i = 0; i < 3; i++) { r = H.id(0, ...arguments); if (i === 1) H.change(arguments); } return S(r); }
function loopEscapeAtLast_new() { let r; for (let i = 0; i < 3; i++) { r = new H.K(0, ...arguments).a; if (i === 1) H.change(arguments); } return S(r); }
function loopEscapeAtLast_seen() { let r; for (let i = 0; i < 3; i++) { r = H.id(...arguments); if (i === 1) H.change(arguments); } return S(r); }
function loopEscapeFirst_lit() { let r; for (let i = 0; i < 3; i++) { if (i === 1) arguments[arguments.length] = "past"; if (i === 1) arguments.length++; r = [0, ...arguments]; } return S(r); }
function loopEscapeFirst_copy() { let r; for (let i = 0; i < 3; i++) { if (i === 1) arguments[arguments.length] = "past"; if (i === 1) arguments.length++; r = [...arguments]; } return S(r); }
function loopEscapeFirst_call() { let r; for (let i = 0; i < 3; i++) { if (i === 1) arguments[arguments.length] = "past"; if (i === 1) arguments.length++; r = H.id(0, ...arguments); } return S(r); }
function loopEscapeFirst_new() { let r; for (let i = 0; i < 3; i++) { if (i === 1) arguments[arguments.length] = "past"; if (i === 1) arguments.length++; r = new H.K(0, ...arguments).a; } return S(r); }
function loopEscapeFirst_seen() { let r; for (let i = 0; i < 3; i++) { if (i === 1) arguments[arguments.length] = "past"; if (i === 1) arguments.length++; r = H.id(...arguments); } return S(r); }
function whileByLength_lit() { const out = []; while (arguments.length > 0 && out.length < 4) { out.push(S([0, ...arguments])); arguments.length--; } return out.join("/"); }
function whileByLength_copy() { const out = []; while (arguments.length > 0 && out.length < 4) { out.push(S([...arguments])); arguments.length--; } return out.join("/"); }
function whileByLength_call() { const out = []; while (arguments.length > 0 && out.length < 4) { out.push(S(H.id(0, ...arguments))); arguments.length--; } return out.join("/"); }
function whileByLength_new() { const out = []; while (arguments.length > 0 && out.length < 4) { out.push(S(new H.K(0, ...arguments).a)); arguments.length--; } return out.join("/"); }
function whileByLength_seen() { const out = []; while (arguments.length > 0 && out.length < 4) { out.push(S(H.id(...arguments))); arguments.length--; } return out.join("/"); }
function finallyChanges_lit() { try { return [0, ...arguments]; } finally { H.change(arguments); } }
function finallyChanges_copy() { try { return [...arguments]; } finally { H.change(arguments); } }
function finallyChanges_call() { try { return H.id(0, ...arguments); } finally { H.change(arguments); } }
function finallyChanges_new() { try { return new H.K(0, ...arguments).a; } finally { H.change(arguments); } }
function finallyChanges_seen() { try { return H.id(...arguments); } finally { H.change(arguments); } }
function finallySpreads_lit() { try { H.change(arguments); } finally { return [0, ...arguments]; } }
function finallySpreads_copy() { try { H.change(arguments); } finally { return [...arguments]; } }
function finallySpreads_call() { try { H.change(arguments); } finally { return H.id(0, ...arguments); } }
function finallySpreads_new() { try { H.change(arguments); } finally { return new H.K(0, ...arguments).a; } }
function finallySpreads_seen() { try { H.change(arguments); } finally { return H.id(...arguments); } }
function catchStores_lit() { try { throw 1; } catch { arguments[0] = "c"; } return [0, ...arguments]; }
function catchStores_copy() { try { throw 1; } catch { arguments[0] = "c"; } return [...arguments]; }
function catchStores_call() { try { throw 1; } catch { arguments[0] = "c"; } return H.id(0, ...arguments); }
function catchStores_new() { try { throw 1; } catch { arguments[0] = "c"; } return new H.K(0, ...arguments).a; }
function catchStores_seen() { try { throw 1; } catch { arguments[0] = "c"; } return H.id(...arguments); }
function catchSpreads_lit() { try { H.change(arguments); H.thrower(); } catch (e) { return [0, ...arguments]; } }
function catchSpreads_copy() { try { H.change(arguments); H.thrower(); } catch (e) { return [...arguments]; } }
function catchSpreads_call() { try { H.change(arguments); H.thrower(); } catch (e) { return H.id(0, ...arguments); } }
function catchSpreads_new() { try { H.change(arguments); H.thrower(); } catch (e) { return new H.K(0, ...arguments).a; } }
function catchSpreads_seen() { try { H.change(arguments); H.thrower(); } catch (e) { return H.id(...arguments); } }
function throwsBetween_lit() { let r; try { r = [0, ...arguments]; H.thrower(arguments); } catch (e) { return S(r) + S([0, ...arguments]); } }
function throwsBetween_copy() { let r; try { r = [...arguments]; H.thrower(arguments); } catch (e) { return S(r) + S([...arguments]); } }
function throwsBetween_call() { let r; try { r = H.id(0, ...arguments); H.thrower(arguments); } catch (e) { return S(r) + S(H.id(0, ...arguments)); } }
function throwsBetween_new() { let r; try { r = new H.K(0, ...arguments).a; H.thrower(arguments); } catch (e) { return S(r) + S(new H.K(0, ...arguments).a); } }
function throwsBetween_seen() { let r; try { r = H.id(...arguments); H.thrower(arguments); } catch (e) { return S(r) + S(H.id(...arguments)); } }
function spreadIntoThrower_lit() { try { H.thrower(0, ...arguments); } catch (e) { return S([0, ...arguments]) + e; } }
function spreadIntoThrower_copy() { try { H.thrower(0, ...arguments); } catch (e) { return S([...arguments]) + e; } }
function spreadIntoThrower_call() { try { H.thrower(0, ...arguments); } catch (e) { return S(H.id(0, ...arguments)) + e; } }
function spreadIntoThrower_new() { try { H.thrower(0, ...arguments); } catch (e) { return S(new H.K(0, ...arguments).a) + e; } }
function spreadIntoThrower_seen() { try { H.thrower(0, ...arguments); } catch (e) { return S(H.id(...arguments)) + e; } }
function switchFallsThrough_lit(k) { switch (k) { case "x": arguments[1] = "one"; case "z": return [0, ...arguments]; default: return S([0, ...arguments]) + "d"; } }
function switchFallsThrough_copy(k) { switch (k) { case "x": arguments[1] = "one"; case "z": return [...arguments]; default: return S([...arguments]) + "d"; } }
function switchFallsThrough_call(k) { switch (k) { case "x": arguments[1] = "one"; case "z": return H.id(0, ...arguments); default: return S(H.id(0, ...arguments)) + "d"; } }
function switchFallsThrough_new(k) { switch (k) { case "x": arguments[1] = "one"; case "z": return new H.K(0, ...arguments).a; default: return S(new H.K(0, ...arguments).a) + "d"; } }
function switchFallsThrough_seen(k) { switch (k) { case "x": arguments[1] = "one"; case "z": return H.id(...arguments); default: return S(H.id(...arguments)) + "d"; } }
function labelledBreak_lit(k) { out: { if (k) break out; arguments[0] = "s"; arguments.length = 1; } return [0, ...arguments]; }
function labelledBreak_copy(k) { out: { if (k) break out; arguments[0] = "s"; arguments.length = 1; } return [...arguments]; }
function labelledBreak_call(k) { out: { if (k) break out; arguments[0] = "s"; arguments.length = 1; } return H.id(0, ...arguments); }
function labelledBreak_new(k) { out: { if (k) break out; arguments[0] = "s"; arguments.length = 1; } return new H.K(0, ...arguments).a; }
function labelledBreak_seen(k) { out: { if (k) break out; arguments[0] = "s"; arguments.length = 1; } return H.id(...arguments); }
function objectAndSpread_lit() { const r = [arguments, ...arguments]; return (r[0] === arguments) + S(r.slice(1)) + S([0, ...arguments]); }
function objectAndSpread_copy() { const r = [arguments, ...arguments]; return (r[0] === arguments) + S(r.slice(1)) + S([...arguments]); }
function objectAndSpread_call() { const r = [arguments, ...arguments]; return (r[0] === arguments) + S(r.slice(1)) + S(H.id(0, ...arguments)); }
function objectAndSpread_new() { const r = [arguments, ...arguments]; return (r[0] === arguments) + S(r.slice(1)) + S(new H.K(0, ...arguments).a); }
function objectAndSpread_seen() { const r = [arguments, ...arguments]; return (r[0] === arguments) + S(r.slice(1)) + S(H.id(...arguments)); }
function spreadAndObject_lit() { const r = [...arguments, arguments]; return (r[r.length - 1] === arguments) + S([0, ...arguments]); }
function spreadAndObject_copy() { const r = [...arguments, arguments]; return (r[r.length - 1] === arguments) + S([...arguments]); }
function spreadAndObject_call() { const r = [...arguments, arguments]; return (r[r.length - 1] === arguments) + S(H.id(0, ...arguments)); }
function spreadAndObject_new() { const r = [...arguments, arguments]; return (r[r.length - 1] === arguments) + S(new H.K(0, ...arguments).a); }
function spreadAndObject_seen() { const r = [...arguments, arguments]; return (r[r.length - 1] === arguments) + S(H.id(...arguments)); }
function sameObjectTwice_lit() { const r = [0, ...arguments]; H.a1 = arguments; H.a2 = arguments; return (H.a1 === H.a2) + S(r); }
function sameObjectTwice_copy() { const r = [...arguments]; H.a1 = arguments; H.a2 = arguments; return (H.a1 === H.a2) + S(r); }
function sameObjectTwice_call() { const r = H.id(0, ...arguments); H.a1 = arguments; H.a2 = arguments; return (H.a1 === H.a2) + S(r); }
function sameObjectTwice_new() { const r = new H.K(0, ...arguments).a; H.a1 = arguments; H.a2 = arguments; return (H.a1 === H.a2) + S(r); }
function sameObjectTwice_seen() { const r = H.id(...arguments); H.a1 = arguments; H.a2 = arguments; return (H.a1 === H.a2) + S(r); }
function escapesOnTwoPaths_lit(c) { const r = [0, ...arguments]; if (c) H.a1 = arguments; else H.a2 = arguments; return S(r) + S(c ? H.a1 : H.a2); }
function escapesOnTwoPaths_copy(c) { const r = [...arguments]; if (c) H.a1 = arguments; else H.a2 = arguments; return S(r) + S(c ? H.a1 : H.a2); }
function escapesOnTwoPaths_call(c) { const r = H.id(0, ...arguments); if (c) H.a1 = arguments; else H.a2 = arguments; return S(r) + S(c ? H.a1 : H.a2); }
function escapesOnTwoPaths_new(c) { const r = new H.K(0, ...arguments).a; if (c) H.a1 = arguments; else H.a2 = arguments; return S(r) + S(c ? H.a1 : H.a2); }
function escapesOnTwoPaths_seen(c) { const r = H.id(...arguments); if (c) H.a1 = arguments; else H.a2 = arguments; return S(r) + S(c ? H.a1 : H.a2); }
function returned_lit() { const r = [0, ...arguments]; H.r = r; return arguments; }
function returned_copy() { const r = [...arguments]; H.r = r; return arguments; }
function returned_call() { const r = H.id(0, ...arguments); H.r = r; return arguments; }
function returned_new() { const r = new H.K(0, ...arguments).a; H.r = r; return arguments; }
function returned_seen() { const r = H.id(...arguments); H.r = r; return arguments; }
function throughVariable_lit() { const x = arguments; x[0] = "x0"; return [0, ...arguments]; }
function throughVariable_copy() { const x = arguments; x[0] = "x0"; return [...arguments]; }
function throughVariable_call() { const x = arguments; x[0] = "x0"; return H.id(0, ...arguments); }
function throughVariable_new() { const x = arguments; x[0] = "x0"; return new H.K(0, ...arguments).a; }
function throughVariable_seen() { const x = arguments; x[0] = "x0"; return H.id(...arguments); }
function throughChoice_lit(c) { const x = c ? arguments : [1]; x[0] = "x0"; return [0, ...arguments]; }
function throughChoice_copy(c) { const x = c ? arguments : [1]; x[0] = "x0"; return [...arguments]; }
function throughChoice_call(c) { const x = c ? arguments : [1]; x[0] = "x0"; return H.id(0, ...arguments); }
function throughChoice_new(c) { const x = c ? arguments : [1]; x[0] = "x0"; return new H.K(0, ...arguments).a; }
function throughChoice_seen(c) { const x = c ? arguments : [1]; x[0] = "x0"; return H.id(...arguments); }
function twice_lit() { return S([0, ...arguments]) + S([0, ...arguments]); }
function twice_copy() { return S([...arguments]) + S([...arguments]); }
function twice_call() { return S(H.id(0, ...arguments)) + S(H.id(0, ...arguments)); }
function twice_new() { return S(new H.K(0, ...arguments).a) + S(new H.K(0, ...arguments).a); }
function twice_seen() { return S(H.id(...arguments)) + S(H.id(...arguments)); }
function nested_lit() { return [...[0, ...arguments], ...[0, ...arguments]]; }
function nested_copy() { return [...[...arguments], ...[...arguments]]; }
function nested_call() { return [...H.id(0, ...arguments), ...H.id(0, ...arguments)]; }
function nested_new() { return [...new H.K(0, ...arguments).a, ...new H.K(0, ...arguments).a]; }
function nested_seen() { return [...H.id(...arguments), ...H.id(...arguments)]; }
function deleteAhead_lit() { delete arguments[0]; return [0, ...arguments]; }
function deleteAhead_copy() { delete arguments[0]; return [...arguments]; }
function deleteAhead_call() { delete arguments[0]; return H.id(0, ...arguments); }
function deleteAhead_new() { delete arguments[0]; return new H.K(0, ...arguments).a; }
function deleteAhead_seen() { delete arguments[0]; return H.id(...arguments); }
function deleteBehind_lit() { const r = [0, ...arguments]; delete arguments[0]; return S(r) + S([0, ...arguments]); }
function deleteBehind_copy() { const r = [...arguments]; delete arguments[0]; return S(r) + S([...arguments]); }
function deleteBehind_call() { const r = H.id(0, ...arguments); delete arguments[0]; return S(r) + S(H.id(0, ...arguments)); }
function deleteBehind_new() { const r = new H.K(0, ...arguments).a; delete arguments[0]; return S(r) + S(new H.K(0, ...arguments).a); }
function deleteBehind_seen() { const r = H.id(...arguments); delete arguments[0]; return S(r) + S(H.id(...arguments)); }
function asksIn_lit() { return (0 in arguments) + "" + (5 in arguments) + ("length" in arguments) + S([0, ...arguments]); }
function asksIn_copy() { return (0 in arguments) + "" + (5 in arguments) + ("length" in arguments) + S([...arguments]); }
function asksIn_call() { return (0 in arguments) + "" + (5 in arguments) + ("length" in arguments) + S(H.id(0, ...arguments)); }
function asksIn_new() { return (0 in arguments) + "" + (5 in arguments) + ("length" in arguments) + S(new H.K(0, ...arguments).a); }
function asksIn_seen() { return (0 in arguments) + "" + (5 in arguments) + ("length" in arguments) + S(H.id(...arguments)); }
function keys_lit() { return Object.keys(arguments).join() + S([0, ...arguments]); }
function keys_copy() { return Object.keys(arguments).join() + S([...arguments]); }
function keys_call() { return Object.keys(arguments).join() + S(H.id(0, ...arguments)); }
function keys_new() { return Object.keys(arguments).join() + S(new H.K(0, ...arguments).a); }
function keys_seen() { return Object.keys(arguments).join() + S(H.id(...arguments)); }
function objectSpread_lit() { return S({ ...arguments }) + S([0, ...arguments]); }
function objectSpread_copy() { return S({ ...arguments }) + S([...arguments]); }
function objectSpread_call() { return S({ ...arguments }) + S(H.id(0, ...arguments)); }
function objectSpread_new() { return S({ ...arguments }) + S(new H.K(0, ...arguments).a); }
function objectSpread_seen() { return S({ ...arguments }) + S(H.id(...arguments)); }
function pattern_lit() { const [a, ...r] = arguments; return one(a) + S(r) + S([0, ...arguments]); }
function pattern_copy() { const [a, ...r] = arguments; return one(a) + S(r) + S([...arguments]); }
function pattern_call() { const [a, ...r] = arguments; return one(a) + S(r) + S(H.id(0, ...arguments)); }
function pattern_new() { const [a, ...r] = arguments; return one(a) + S(r) + S(new H.K(0, ...arguments).a); }
function pattern_seen() { const [a, ...r] = arguments; return one(a) + S(r) + S(H.id(...arguments)); }
function patternStores_lit() { [arguments[0], arguments[1]] = [arguments[1], arguments[0]]; return [0, ...arguments]; }
function patternStores_copy() { [arguments[0], arguments[1]] = [arguments[1], arguments[0]]; return [...arguments]; }
function patternStores_call() { [arguments[0], arguments[1]] = [arguments[1], arguments[0]]; return H.id(0, ...arguments); }
function patternStores_new() { [arguments[0], arguments[1]] = [arguments[1], arguments[0]]; return new H.K(0, ...arguments).a; }
function patternStores_seen() { [arguments[0], arguments[1]] = [arguments[1], arguments[0]]; return H.id(...arguments); }
function forOf_lit() { let n = ""; for (const x of arguments) n += one(x); return n + S([0, ...arguments]); }
function forOf_copy() { let n = ""; for (const x of arguments) n += one(x); return n + S([...arguments]); }
function forOf_call() { let n = ""; for (const x of arguments) n += one(x); return n + S(H.id(0, ...arguments)); }
function forOf_new() { let n = ""; for (const x of arguments) n += one(x); return n + S(new H.K(0, ...arguments).a); }
function forOf_seen() { let n = ""; for (const x of arguments) n += one(x); return n + S(H.id(...arguments)); }
function forOfStores_lit() { let i = 0; for (const x of arguments) arguments[i++] = one(x) + "!"; return [0, ...arguments]; }
function forOfStores_copy() { let i = 0; for (const x of arguments) arguments[i++] = one(x) + "!"; return [...arguments]; }
function forOfStores_call() { let i = 0; for (const x of arguments) arguments[i++] = one(x) + "!"; return H.id(0, ...arguments); }
function forOfStores_new() { let i = 0; for (const x of arguments) arguments[i++] = one(x) + "!"; return new H.K(0, ...arguments).a; }
function forOfStores_seen() { let i = 0; for (const x of arguments) arguments[i++] = one(x) + "!"; return H.id(...arguments); }
function forIn_lit() { let n = ""; for (const k in arguments) n += k; return n + S([0, ...arguments]); }
function forIn_copy() { let n = ""; for (const k in arguments) n += k; return n + S([...arguments]); }
function forIn_call() { let n = ""; for (const k in arguments) n += k; return n + S(H.id(0, ...arguments)); }
function forIn_new() { let n = ""; for (const k in arguments) n += k; return n + S(new H.K(0, ...arguments).a); }
function forIn_seen() { let n = ""; for (const k in arguments) n += k; return n + S(H.id(...arguments)); }
function typeofIt_lit() { return typeof arguments + S([0, ...arguments]); }
function typeofIt_copy() { return typeof arguments + S([...arguments]); }
function typeofIt_call() { return typeof arguments + S(H.id(0, ...arguments)); }
function typeofIt_new() { return typeof arguments + S(new H.K(0, ...arguments).a); }
function typeofIt_seen() { return typeof arguments + S(H.id(...arguments)); }
function tag_lit() { return Object.prototype.toString.call(arguments) + S([0, ...arguments]); }
function tag_copy() { return Object.prototype.toString.call(arguments) + S([...arguments]); }
function tag_call() { return Object.prototype.toString.call(arguments) + S(H.id(0, ...arguments)); }
function tag_new() { return Object.prototype.toString.call(arguments) + S(new H.K(0, ...arguments).a); }
function tag_seen() { return Object.prototype.toString.call(arguments) + S(H.id(...arguments)); }
function byName_lit() { return one(arguments["length"]) + one(arguments["0"]) + (arguments[Symbol.iterator] === Array.prototype.values) + S([0, ...arguments]); }
function byName_copy() { return one(arguments["length"]) + one(arguments["0"]) + (arguments[Symbol.iterator] === Array.prototype.values) + S([...arguments]); }
function byName_call() { return one(arguments["length"]) + one(arguments["0"]) + (arguments[Symbol.iterator] === Array.prototype.values) + S(H.id(0, ...arguments)); }
function byName_new() { return one(arguments["length"]) + one(arguments["0"]) + (arguments[Symbol.iterator] === Array.prototype.values) + S(new H.K(0, ...arguments).a); }
function byName_seen() { return one(arguments["length"]) + one(arguments["0"]) + (arguments[Symbol.iterator] === Array.prototype.values) + S(H.id(...arguments)); }
function oddKeys_lit() { return one(arguments[-1]) + one(arguments[1.5]) + one(arguments[1e9]) + one(arguments["x"]) + S([0, ...arguments]); }
function oddKeys_copy() { return one(arguments[-1]) + one(arguments[1.5]) + one(arguments[1e9]) + one(arguments["x"]) + S([...arguments]); }
function oddKeys_call() { return one(arguments[-1]) + one(arguments[1.5]) + one(arguments[1e9]) + one(arguments["x"]) + S(H.id(0, ...arguments)); }
function oddKeys_new() { return one(arguments[-1]) + one(arguments[1.5]) + one(arguments[1e9]) + one(arguments["x"]) + S(new H.K(0, ...arguments).a); }
function oddKeys_seen() { return one(arguments[-1]) + one(arguments[1.5]) + one(arguments[1e9]) + one(arguments["x"]) + S(H.id(...arguments)); }
function noPrototype_lit() { Object.setPrototypeOf(arguments, null); return [0, ...arguments]; }
function noPrototype_copy() { Object.setPrototypeOf(arguments, null); return [...arguments]; }
function noPrototype_call() { Object.setPrototypeOf(arguments, null); return H.id(0, ...arguments); }
function noPrototype_new() { Object.setPrototypeOf(arguments, null); return new H.K(0, ...arguments).a; }
function noPrototype_seen() { Object.setPrototypeOf(arguments, null); return H.id(...arguments); }
function compound_lit() { arguments[0] += "+"; arguments[2]++; return [0, ...arguments]; }
function compound_copy() { arguments[0] += "+"; arguments[2]++; return [...arguments]; }
function compound_call() { arguments[0] += "+"; arguments[2]++; return H.id(0, ...arguments); }
function compound_new() { arguments[0] += "+"; arguments[2]++; return new H.K(0, ...arguments).a; }
function compound_seen() { arguments[0] += "+"; arguments[2]++; return H.id(...arguments); }
function lengthCompound_lit() { arguments.length--; return [0, ...arguments]; }
function lengthCompound_copy() { arguments.length--; return [...arguments]; }
function lengthCompound_call() { arguments.length--; return H.id(0, ...arguments); }
function lengthCompound_new() { arguments.length--; return new H.K(0, ...arguments).a; }
function lengthCompound_seen() { arguments.length--; return H.id(...arguments); }
function lengthZero_lit() { arguments.length = 0; return [0, ...arguments]; }
function lengthZero_copy() { arguments.length = 0; return [...arguments]; }
function lengthZero_call() { arguments.length = 0; return H.id(0, ...arguments); }
function lengthZero_new() { arguments.length = 0; return new H.K(0, ...arguments).a; }
function lengthZero_seen() { arguments.length = 0; return H.id(...arguments); }
function lengthOdd_lit() { arguments.length = "2"; return [0, ...arguments]; }
function lengthOdd_copy() { arguments.length = "2"; return [...arguments]; }
function lengthOdd_call() { arguments.length = "2"; return H.id(0, ...arguments); }
function lengthOdd_new() { arguments.length = "2"; return new H.K(0, ...arguments).a; }
function lengthOdd_seen() { arguments.length = "2"; return H.id(...arguments); }
function named_lit() { arguments.extra = 1; return [0, ...arguments]; }
function named_copy() { arguments.extra = 1; return [...arguments]; }
function named_call() { arguments.extra = 1; return H.id(0, ...arguments); }
function named_new() { arguments.extra = 1; return new H.K(0, ...arguments).a; }
function named_seen() { arguments.extra = 1; return H.id(...arguments); }
function closureStores_lit() { const g = () => { arguments[0] = "closure"; }; g(); return [0, ...arguments]; }
function closureStores_copy() { const g = () => { arguments[0] = "closure"; }; g(); return [...arguments]; }
function closureStores_call() { const g = () => { arguments[0] = "closure"; }; g(); return H.id(0, ...arguments); }
function closureStores_new() { const g = () => { arguments[0] = "closure"; }; g(); return new H.K(0, ...arguments).a; }
function closureStores_seen() { const g = () => { arguments[0] = "closure"; }; g(); return H.id(...arguments); }
function closureKeeps_lit() { const g = () => arguments; const r = [0, ...arguments]; g()[0] = "later"; return S(r) + S([0, ...arguments]); }
function closureKeeps_copy() { const g = () => arguments; const r = [...arguments]; g()[0] = "later"; return S(r) + S([...arguments]); }
function closureKeeps_call() { const g = () => arguments; const r = H.id(0, ...arguments); g()[0] = "later"; return S(r) + S(H.id(0, ...arguments)); }
function closureKeeps_new() { const g = () => arguments; const r = new H.K(0, ...arguments).a; g()[0] = "later"; return S(r) + S(new H.K(0, ...arguments).a); }
function closureKeeps_seen() { const g = () => arguments; const r = H.id(...arguments); g()[0] = "later"; return S(r) + S(H.id(...arguments)); }
function closureSpreads_lit() { const g = () => [0, ...arguments]; arguments[0] = "first"; return g(); }
function closureSpreads_copy() { const g = () => [...arguments]; arguments[0] = "first"; return g(); }
function closureSpreads_call() { const g = () => H.id(0, ...arguments); arguments[0] = "first"; return g(); }
function closureSpreads_new() { const g = () => new H.K(0, ...arguments).a; arguments[0] = "first"; return g(); }
function closureSpreads_seen() { const g = () => H.id(...arguments); arguments[0] = "first"; return g(); }
function closureHandedOn_lit() { H.g = () => { arguments[0] = "handed"; }; const r = [0, ...arguments]; H.g(); return S(r) + S([0, ...arguments]); }
function closureHandedOn_copy() { H.g = () => { arguments[0] = "handed"; }; const r = [...arguments]; H.g(); return S(r) + S([...arguments]); }
function closureHandedOn_call() { H.g = () => { arguments[0] = "handed"; }; const r = H.id(0, ...arguments); H.g(); return S(r) + S(H.id(0, ...arguments)); }
function closureHandedOn_new() { H.g = () => { arguments[0] = "handed"; }; const r = new H.K(0, ...arguments).a; H.g(); return S(r) + S(new H.K(0, ...arguments).a); }
function closureHandedOn_seen() { H.g = () => { arguments[0] = "handed"; }; const r = H.id(...arguments); H.g(); return S(r) + S(H.id(...arguments)); }
function arrayFrom_lit() { return S(Array.from(arguments)) + S([0, ...arguments]); }
function arrayFrom_copy() { return S(Array.from(arguments)) + S([...arguments]); }
function arrayFrom_call() { return S(Array.from(arguments)) + S(H.id(0, ...arguments)); }
function arrayFrom_new() { return S(Array.from(arguments)) + S(new H.K(0, ...arguments).a); }
function arrayFrom_seen() { return S(Array.from(arguments)) + S(H.id(...arguments)); }
function slice_lit() { return S(Array.prototype.slice.call(arguments, 1)) + S([0, ...arguments]); }
function slice_copy() { return S(Array.prototype.slice.call(arguments, 1)) + S([...arguments]); }
function slice_call() { return S(Array.prototype.slice.call(arguments, 1)) + S(H.id(0, ...arguments)); }
function slice_new() { return S(Array.prototype.slice.call(arguments, 1)) + S(new H.K(0, ...arguments).a); }
function slice_seen() { return S(Array.prototype.slice.call(arguments, 1)) + S(H.id(...arguments)); }
function applyToo_lit() { return S(H.id.apply(null, arguments)) + S([0, ...arguments]); }
function applyToo_copy() { return S(H.id.apply(null, arguments)) + S([...arguments]); }
function applyToo_call() { return S(H.id.apply(null, arguments)) + S(H.id(0, ...arguments)); }
function applyToo_new() { return S(H.id.apply(null, arguments)) + S(new H.K(0, ...arguments).a); }
function applyToo_seen() { return S(H.id.apply(null, arguments)) + S(H.id(...arguments)); }
function json_lit() { return JSON.stringify(arguments) + S([0, ...arguments]); }
function json_copy() { return JSON.stringify(arguments) + S([...arguments]); }
function json_call() { return JSON.stringify(arguments) + S(H.id(0, ...arguments)); }
function json_new() { return JSON.stringify(arguments) + S(new H.K(0, ...arguments).a); }
function json_seen() { return JSON.stringify(arguments) + S(H.id(...arguments)); }
function accessorBehind_lit() { const r = [0, ...arguments]; Object.defineProperty(arguments, 0, { get() { return "got"; } }); return S(r) + S([0, ...arguments]); }
function accessorBehind_copy() { const r = [...arguments]; Object.defineProperty(arguments, 0, { get() { return "got"; } }); return S(r) + S([...arguments]); }
function accessorBehind_call() { const r = H.id(0, ...arguments); Object.defineProperty(arguments, 0, { get() { return "got"; } }); return S(r) + S(H.id(0, ...arguments)); }
function accessorBehind_new() { const r = new H.K(0, ...arguments).a; Object.defineProperty(arguments, 0, { get() { return "got"; } }); return S(r) + S(new H.K(0, ...arguments).a); }
function accessorBehind_seen() { const r = H.id(...arguments); Object.defineProperty(arguments, 0, { get() { return "got"; } }); return S(r) + S(H.id(...arguments)); }
function namedParameters_lit(a, b) { return [a, ...[0, ...arguments], b]; }
function namedParameters_copy(a, b) { return [a, ...[...arguments], b]; }
function namedParameters_call(a, b) { return [a, ...H.id(0, ...arguments), b]; }
function namedParameters_new(a, b) { return [a, ...new H.K(0, ...arguments).a, b]; }
function namedParameters_seen(a, b) { return [a, ...H.id(...arguments), b]; }
function ownRest_lit(a, ...r) { r[0] = "r"; r.push("p"); return [a, ...[0, ...arguments], ...r]; }
function ownRest_copy(a, ...r) { r[0] = "r"; r.push("p"); return [a, ...[...arguments], ...r]; }
function ownRest_call(a, ...r) { r[0] = "r"; r.push("p"); return [a, ...H.id(0, ...arguments), ...r]; }
function ownRest_new(a, ...r) { r[0] = "r"; r.push("p"); return [a, ...new H.K(0, ...arguments).a, ...r]; }
function ownRest_seen(a, ...r) { r[0] = "r"; r.push("p"); return [a, ...H.id(...arguments), ...r]; }
function onlyRest_lit(...r) { r[0] = "r"; r.length = 1; return [...[0, ...arguments], ...r]; }
function onlyRest_copy(...r) { r[0] = "r"; r.length = 1; return [...[...arguments], ...r]; }
function onlyRest_call(...r) { r[0] = "r"; r.length = 1; return [...H.id(0, ...arguments), ...r]; }
function onlyRest_new(...r) { r[0] = "r"; r.length = 1; return [...new H.K(0, ...arguments).a, ...r]; }
function onlyRest_seen(...r) { r[0] = "r"; r.length = 1; return [...H.id(...arguments), ...r]; }
function restSorted_lit(...r) { r.reverse(); return [0, ...arguments]; }
function restSorted_copy(...r) { r.reverse(); return [...arguments]; }
function restSorted_call(...r) { r.reverse(); return H.id(0, ...arguments); }
function restSorted_new(...r) { r.reverse(); return new H.K(0, ...arguments).a; }
function restSorted_seen(...r) { r.reverse(); return H.id(...arguments); }
function defaultReads_lit(a = "d", b = [0, ...arguments]) { return [a, ...b, ...[0, ...arguments]]; }
function defaultReads_copy(a = "d", b = [...arguments]) { return [a, ...b, ...[...arguments]]; }
function defaultReads_call(a = "d", b = H.id(0, ...arguments)) { return [a, ...b, ...H.id(0, ...arguments)]; }
function defaultReads_new(a = "d", b = new H.K(0, ...arguments).a) { return [a, ...b, ...new H.K(0, ...arguments).a]; }
function defaultReads_seen(a = "d", b = H.id(...arguments)) { return [a, ...b, ...H.id(...arguments)]; }
function defaultStores_lit(a = (arguments[1] = "stored", "d")) { return [0, ...arguments]; }
function defaultStores_copy(a = (arguments[1] = "stored", "d")) { return [...arguments]; }
function defaultStores_call(a = (arguments[1] = "stored", "d")) { return H.id(0, ...arguments); }
function defaultStores_new(a = (arguments[1] = "stored", "d")) { return new H.K(0, ...arguments).a; }
function defaultStores_seen(a = (arguments[1] = "stored", "d")) { return H.id(...arguments); }
function destructured_lit({ x } = {}, [y] = []) { return [x, y, ...[0, ...arguments]].length; }
function destructured_copy({ x } = {}, [y] = []) { return [x, y, ...[...arguments]].length; }
function destructured_call({ x } = {}, [y] = []) { return [x, y, ...H.id(0, ...arguments)].length; }
function destructured_new({ x } = {}, [y] = []) { return [x, y, ...new H.K(0, ...arguments).a].length; }
function destructured_seen({ x } = {}, [y] = []) { return [x, y, ...H.id(...arguments)].length; }
function recursive_lit(n) { return typeof n === "number" && n > 0 ? [n, ...recursive_lit(n - 1, ...arguments)] : [0, ...arguments]; }
function recursive_copy(n) { return typeof n === "number" && n > 0 ? [n, ...recursive_copy(n - 1, ...arguments)] : [...arguments]; }
function recursive_call(n) { return typeof n === "number" && n > 0 ? [n, ...recursive_call(n - 1, ...arguments)] : H.id(0, ...arguments); }
function recursive_new(n) { return typeof n === "number" && n > 0 ? [n, ...recursive_new(n - 1, ...arguments)] : new H.K(0, ...arguments).a; }
function recursive_seen(n) { return typeof n === "number" && n > 0 ? [n, ...recursive_seen(n - 1, ...arguments)] : H.id(...arguments); }
function callsItself_lit(n) { if (n === "x") { const r = [0, ...arguments]; callsItself_lit("inner", 1); return S(r) + S([0, ...arguments]); } return [0, ...arguments]; }
function callsItself_copy(n) { if (n === "x") { const r = [...arguments]; callsItself_copy("inner", 1); return S(r) + S([...arguments]); } return [...arguments]; }
function callsItself_call(n) { if (n === "x") { const r = H.id(0, ...arguments); callsItself_call("inner", 1); return S(r) + S(H.id(0, ...arguments)); } return H.id(0, ...arguments); }
function callsItself_new(n) { if (n === "x") { const r = new H.K(0, ...arguments).a; callsItself_new("inner", 1); return S(r) + S(new H.K(0, ...arguments).a); } return new H.K(0, ...arguments).a; }
function callsItself_seen(n) { if (n === "x") { const r = H.id(...arguments); callsItself_seen("inner", 1); return S(r) + S(H.id(...arguments)); } return H.id(...arguments); }
function sealed_lit() { Object.seal(arguments); arguments[0] = "sealed"; return [0, ...arguments]; }
function sealed_copy() { Object.seal(arguments); arguments[0] = "sealed"; return [...arguments]; }
function sealed_call() { Object.seal(arguments); arguments[0] = "sealed"; return H.id(0, ...arguments); }
function sealed_new() { Object.seal(arguments); arguments[0] = "sealed"; return new H.K(0, ...arguments).a; }
function sealed_seen() { Object.seal(arguments); arguments[0] = "sealed"; return H.id(...arguments); }
function assigned_lit(a) { a = "assigned"; return [a, ...[0, ...arguments]]; }
function assigned_copy(a) { a = "assigned"; return [a, ...[...arguments]]; }
function assigned_call(a) { a = "assigned"; return [a, ...H.id(0, ...arguments)]; }
function assigned_new(a) { a = "assigned"; return [a, ...new H.K(0, ...arguments).a]; }
function assigned_seen(a) { a = "assigned"; return [a, ...H.id(...arguments)]; }
function calleeThrows_lit() { try { arguments.callee; } catch (e) { return e.name + S([0, ...arguments]); } }
function calleeThrows_copy() { try { arguments.callee; } catch (e) { return e.name + S([...arguments]); } }
function calleeThrows_call() { try { arguments.callee; } catch (e) { return e.name + S(H.id(0, ...arguments)); } }
function calleeThrows_new() { try { arguments.callee; } catch (e) { return e.name + S(new H.K(0, ...arguments).a); } }
function calleeThrows_seen() { try { arguments.callee; } catch (e) { return e.name + S(H.id(...arguments)); } }
const all = [["escapeOnOnePath_lit", escapeOnOnePath_lit], ["escapeOnOnePath_copy", escapeOnOnePath_copy], ["escapeOnOnePath_call", escapeOnOnePath_call], ["escapeOnOnePath_new", escapeOnOnePath_new], ["escapeOnOnePath_seen", escapeOnOnePath_seen], ["spreadThenEscape_lit", spreadThenEscape_lit], ["spreadThenEscape_copy", spreadThenEscape_copy], ["spreadThenEscape_call", spreadThenEscape_call], ["spreadThenEscape_new", spreadThenEscape_new], ["spreadThenEscape_seen", spreadThenEscape_seen], ["spreadThenEscapeThenChange_lit", spreadThenEscapeThenChange_lit], ["spreadThenEscapeThenChange_copy", spreadThenEscapeThenChange_copy], ["spreadThenEscapeThenChange_call", spreadThenEscapeThenChange_call], ["spreadThenEscapeThenChange_new", spreadThenEscapeThenChange_new], ["spreadThenEscapeThenChange_seen", spreadThenEscapeThenChange_seen], ["escapeThenSpread_lit", escapeThenSpread_lit], ["escapeThenSpread_copy", escapeThenSpread_copy], ["escapeThenSpread_call", escapeThenSpread_call], ["escapeThenSpread_new", escapeThenSpread_new], ["escapeThenSpread_seen", escapeThenSpread_seen], ["escapeInCondition_lit", escapeInCondition_lit], ["escapeInCondition_copy", escapeInCondition_copy], ["escapeInCondition_call", escapeInCondition_call], ["escapeInCondition_new", escapeInCondition_new], ["escapeInCondition_seen", escapeInCondition_seen], ["storeInCondition_lit", storeInCondition_lit], ["storeInCondition_copy", storeInCondition_copy], ["storeInCondition_call", storeInCondition_call], ["storeInCondition_new", storeInCondition_new], ["storeInCondition_seen", storeInCondition_seen], ["loopOfSpreads_lit", loopOfSpreads_lit], ["loopOfSpreads_copy", loopOfSpreads_copy], ["loopOfSpreads_call", loopOfSpreads_call], ["loopOfSpreads_new", loopOfSpreads_new], ["loopOfSpreads_seen", loopOfSpreads_seen], ["loopSpreadAndEscape_lit", loopSpreadAndEscape_lit], ["loopSpreadAndEscape_copy", loopSpreadAndEscape_copy], ["loopSpreadAndEscape_call", loopSpreadAndEscape_call], ["loopSpreadAndEscape_new", loopSpreadAndEscape_new], ["loopSpreadAndEscape_seen", loopSpreadAndEscape_seen], ["loopEscapeAtLast_lit", loopEscapeAtLast_lit], ["loopEscapeAtLast_copy", loopEscapeAtLast_copy], ["loopEscapeAtLast_call", loopEscapeAtLast_call], ["loopEscapeAtLast_new", loopEscapeAtLast_new], ["loopEscapeAtLast_seen", loopEscapeAtLast_seen], ["loopEscapeFirst_lit", loopEscapeFirst_lit], ["loopEscapeFirst_copy", loopEscapeFirst_copy], ["loopEscapeFirst_call", loopEscapeFirst_call], ["loopEscapeFirst_new", loopEscapeFirst_new], ["loopEscapeFirst_seen", loopEscapeFirst_seen], ["whileByLength_lit", whileByLength_lit], ["whileByLength_copy", whileByLength_copy], ["whileByLength_call", whileByLength_call], ["whileByLength_new", whileByLength_new], ["whileByLength_seen", whileByLength_seen], ["finallyChanges_lit", finallyChanges_lit], ["finallyChanges_copy", finallyChanges_copy], ["finallyChanges_call", finallyChanges_call], ["finallyChanges_new", finallyChanges_new], ["finallyChanges_seen", finallyChanges_seen], ["finallySpreads_lit", finallySpreads_lit], ["finallySpreads_copy", finallySpreads_copy], ["finallySpreads_call", finallySpreads_call], ["finallySpreads_new", finallySpreads_new], ["finallySpreads_seen", finallySpreads_seen], ["catchStores_lit", catchStores_lit], ["catchStores_copy", catchStores_copy], ["catchStores_call", catchStores_call], ["catchStores_new", catchStores_new], ["catchStores_seen", catchStores_seen], ["catchSpreads_lit", catchSpreads_lit], ["catchSpreads_copy", catchSpreads_copy], ["catchSpreads_call", catchSpreads_call], ["catchSpreads_new", catchSpreads_new], ["catchSpreads_seen", catchSpreads_seen], ["throwsBetween_lit", throwsBetween_lit], ["throwsBetween_copy", throwsBetween_copy], ["throwsBetween_call", throwsBetween_call], ["throwsBetween_new", throwsBetween_new], ["throwsBetween_seen", throwsBetween_seen], ["spreadIntoThrower_lit", spreadIntoThrower_lit], ["spreadIntoThrower_copy", spreadIntoThrower_copy], ["spreadIntoThrower_call", spreadIntoThrower_call], ["spreadIntoThrower_new", spreadIntoThrower_new], ["spreadIntoThrower_seen", spreadIntoThrower_seen], ["switchFallsThrough_lit", switchFallsThrough_lit], ["switchFallsThrough_copy", switchFallsThrough_copy], ["switchFallsThrough_call", switchFallsThrough_call], ["switchFallsThrough_new", switchFallsThrough_new], ["switchFallsThrough_seen", switchFallsThrough_seen], ["labelledBreak_lit", labelledBreak_lit], ["labelledBreak_copy", labelledBreak_copy], ["labelledBreak_call", labelledBreak_call], ["labelledBreak_new", labelledBreak_new], ["labelledBreak_seen", labelledBreak_seen], ["objectAndSpread_lit", objectAndSpread_lit], ["objectAndSpread_copy", objectAndSpread_copy], ["objectAndSpread_call", objectAndSpread_call], ["objectAndSpread_new", objectAndSpread_new], ["objectAndSpread_seen", objectAndSpread_seen], ["spreadAndObject_lit", spreadAndObject_lit], ["spreadAndObject_copy", spreadAndObject_copy], ["spreadAndObject_call", spreadAndObject_call], ["spreadAndObject_new", spreadAndObject_new], ["spreadAndObject_seen", spreadAndObject_seen], ["sameObjectTwice_lit", sameObjectTwice_lit], ["sameObjectTwice_copy", sameObjectTwice_copy], ["sameObjectTwice_call", sameObjectTwice_call], ["sameObjectTwice_new", sameObjectTwice_new], ["sameObjectTwice_seen", sameObjectTwice_seen], ["escapesOnTwoPaths_lit", escapesOnTwoPaths_lit], ["escapesOnTwoPaths_copy", escapesOnTwoPaths_copy], ["escapesOnTwoPaths_call", escapesOnTwoPaths_call], ["escapesOnTwoPaths_new", escapesOnTwoPaths_new], ["escapesOnTwoPaths_seen", escapesOnTwoPaths_seen], ["returned_lit", returned_lit], ["returned_copy", returned_copy], ["returned_call", returned_call], ["returned_new", returned_new], ["returned_seen", returned_seen], ["throughVariable_lit", throughVariable_lit], ["throughVariable_copy", throughVariable_copy], ["throughVariable_call", throughVariable_call], ["throughVariable_new", throughVariable_new], ["throughVariable_seen", throughVariable_seen], ["throughChoice_lit", throughChoice_lit], ["throughChoice_copy", throughChoice_copy], ["throughChoice_call", throughChoice_call], ["throughChoice_new", throughChoice_new], ["throughChoice_seen", throughChoice_seen], ["twice_lit", twice_lit], ["twice_copy", twice_copy], ["twice_call", twice_call], ["twice_new", twice_new], ["twice_seen", twice_seen], ["nested_lit", nested_lit], ["nested_copy", nested_copy], ["nested_call", nested_call], ["nested_new", nested_new], ["nested_seen", nested_seen], ["deleteAhead_lit", deleteAhead_lit], ["deleteAhead_copy", deleteAhead_copy], ["deleteAhead_call", deleteAhead_call], ["deleteAhead_new", deleteAhead_new], ["deleteAhead_seen", deleteAhead_seen], ["deleteBehind_lit", deleteBehind_lit], ["deleteBehind_copy", deleteBehind_copy], ["deleteBehind_call", deleteBehind_call], ["deleteBehind_new", deleteBehind_new], ["deleteBehind_seen", deleteBehind_seen], ["asksIn_lit", asksIn_lit], ["asksIn_copy", asksIn_copy], ["asksIn_call", asksIn_call], ["asksIn_new", asksIn_new], ["asksIn_seen", asksIn_seen], ["keys_lit", keys_lit], ["keys_copy", keys_copy], ["keys_call", keys_call], ["keys_new", keys_new], ["keys_seen", keys_seen], ["objectSpread_lit", objectSpread_lit], ["objectSpread_copy", objectSpread_copy], ["objectSpread_call", objectSpread_call], ["objectSpread_new", objectSpread_new], ["objectSpread_seen", objectSpread_seen], ["pattern_lit", pattern_lit], ["pattern_copy", pattern_copy], ["pattern_call", pattern_call], ["pattern_new", pattern_new], ["pattern_seen", pattern_seen], ["patternStores_lit", patternStores_lit], ["patternStores_copy", patternStores_copy], ["patternStores_call", patternStores_call], ["patternStores_new", patternStores_new], ["patternStores_seen", patternStores_seen], ["forOf_lit", forOf_lit], ["forOf_copy", forOf_copy], ["forOf_call", forOf_call], ["forOf_new", forOf_new], ["forOf_seen", forOf_seen], ["forOfStores_lit", forOfStores_lit], ["forOfStores_copy", forOfStores_copy], ["forOfStores_call", forOfStores_call], ["forOfStores_new", forOfStores_new], ["forOfStores_seen", forOfStores_seen], ["forIn_lit", forIn_lit], ["forIn_copy", forIn_copy], ["forIn_call", forIn_call], ["forIn_new", forIn_new], ["forIn_seen", forIn_seen], ["typeofIt_lit", typeofIt_lit], ["typeofIt_copy", typeofIt_copy], ["typeofIt_call", typeofIt_call], ["typeofIt_new", typeofIt_new], ["typeofIt_seen", typeofIt_seen], ["tag_lit", tag_lit], ["tag_copy", tag_copy], ["tag_call", tag_call], ["tag_new", tag_new], ["tag_seen", tag_seen], ["byName_lit", byName_lit], ["byName_copy", byName_copy], ["byName_call", byName_call], ["byName_new", byName_new], ["byName_seen", byName_seen], ["oddKeys_lit", oddKeys_lit], ["oddKeys_copy", oddKeys_copy], ["oddKeys_call", oddKeys_call], ["oddKeys_new", oddKeys_new], ["oddKeys_seen", oddKeys_seen], ["noPrototype_lit", noPrototype_lit], ["noPrototype_copy", noPrototype_copy], ["noPrototype_call", noPrototype_call], ["noPrototype_new", noPrototype_new], ["noPrototype_seen", noPrototype_seen], ["compound_lit", compound_lit], ["compound_copy", compound_copy], ["compound_call", compound_call], ["compound_new", compound_new], ["compound_seen", compound_seen], ["lengthCompound_lit", lengthCompound_lit], ["lengthCompound_copy", lengthCompound_copy], ["lengthCompound_call", lengthCompound_call], ["lengthCompound_new", lengthCompound_new], ["lengthCompound_seen", lengthCompound_seen], ["lengthZero_lit", lengthZero_lit], ["lengthZero_copy", lengthZero_copy], ["lengthZero_call", lengthZero_call], ["lengthZero_new", lengthZero_new], ["lengthZero_seen", lengthZero_seen], ["lengthOdd_lit", lengthOdd_lit], ["lengthOdd_copy", lengthOdd_copy], ["lengthOdd_call", lengthOdd_call], ["lengthOdd_new", lengthOdd_new], ["lengthOdd_seen", lengthOdd_seen], ["named_lit", named_lit], ["named_copy", named_copy], ["named_call", named_call], ["named_new", named_new], ["named_seen", named_seen], ["closureStores_lit", closureStores_lit], ["closureStores_copy", closureStores_copy], ["closureStores_call", closureStores_call], ["closureStores_new", closureStores_new], ["closureStores_seen", closureStores_seen], ["closureKeeps_lit", closureKeeps_lit], ["closureKeeps_copy", closureKeeps_copy], ["closureKeeps_call", closureKeeps_call], ["closureKeeps_new", closureKeeps_new], ["closureKeeps_seen", closureKeeps_seen], ["closureSpreads_lit", closureSpreads_lit], ["closureSpreads_copy", closureSpreads_copy], ["closureSpreads_call", closureSpreads_call], ["closureSpreads_new", closureSpreads_new], ["closureSpreads_seen", closureSpreads_seen], ["closureHandedOn_lit", closureHandedOn_lit], ["closureHandedOn_copy", closureHandedOn_copy], ["closureHandedOn_call", closureHandedOn_call], ["closureHandedOn_new", closureHandedOn_new], ["closureHandedOn_seen", closureHandedOn_seen], ["arrayFrom_lit", arrayFrom_lit], ["arrayFrom_copy", arrayFrom_copy], ["arrayFrom_call", arrayFrom_call], ["arrayFrom_new", arrayFrom_new], ["arrayFrom_seen", arrayFrom_seen], ["slice_lit", slice_lit], ["slice_copy", slice_copy], ["slice_call", slice_call], ["slice_new", slice_new], ["slice_seen", slice_seen], ["applyToo_lit", applyToo_lit], ["applyToo_copy", applyToo_copy], ["applyToo_call", applyToo_call], ["applyToo_new", applyToo_new], ["applyToo_seen", applyToo_seen], ["json_lit", json_lit], ["json_copy", json_copy], ["json_call", json_call], ["json_new", json_new], ["json_seen", json_seen], ["accessorBehind_lit", accessorBehind_lit], ["accessorBehind_copy", accessorBehind_copy], ["accessorBehind_call", accessorBehind_call], ["accessorBehind_new", accessorBehind_new], ["accessorBehind_seen", accessorBehind_seen], ["namedParameters_lit", namedParameters_lit], ["namedParameters_copy", namedParameters_copy], ["namedParameters_call", namedParameters_call], ["namedParameters_new", namedParameters_new], ["namedParameters_seen", namedParameters_seen], ["ownRest_lit", ownRest_lit], ["ownRest_copy", ownRest_copy], ["ownRest_call", ownRest_call], ["ownRest_new", ownRest_new], ["ownRest_seen", ownRest_seen], ["onlyRest_lit", onlyRest_lit], ["onlyRest_copy", onlyRest_copy], ["onlyRest_call", onlyRest_call], ["onlyRest_new", onlyRest_new], ["onlyRest_seen", onlyRest_seen], ["restSorted_lit", restSorted_lit], ["restSorted_copy", restSorted_copy], ["restSorted_call", restSorted_call], ["restSorted_new", restSorted_new], ["restSorted_seen", restSorted_seen], ["defaultReads_lit", defaultReads_lit], ["defaultReads_copy", defaultReads_copy], ["defaultReads_call", defaultReads_call], ["defaultReads_new", defaultReads_new], ["defaultReads_seen", defaultReads_seen], ["defaultStores_lit", defaultStores_lit], ["defaultStores_copy", defaultStores_copy], ["defaultStores_call", defaultStores_call], ["defaultStores_new", defaultStores_new], ["defaultStores_seen", defaultStores_seen], ["destructured_lit", destructured_lit], ["destructured_copy", destructured_copy], ["destructured_call", destructured_call], ["destructured_new", destructured_new], ["destructured_seen", destructured_seen], ["recursive_lit", recursive_lit], ["recursive_copy", recursive_copy], ["recursive_call", recursive_call], ["recursive_new", recursive_new], ["recursive_seen", recursive_seen], ["callsItself_lit", callsItself_lit], ["callsItself_copy", callsItself_copy], ["callsItself_call", callsItself_call], ["callsItself_new", callsItself_new], ["callsItself_seen", callsItself_seen], ["sealed_lit", sealed_lit], ["sealed_copy", sealed_copy], ["sealed_call", sealed_call], ["sealed_new", sealed_new], ["sealed_seen", sealed_seen], ["assigned_lit", assigned_lit], ["assigned_copy", assigned_copy], ["assigned_call", assigned_call], ["assigned_new", assigned_new], ["assigned_seen", assigned_seen], ["calleeThrows_lit", calleeThrows_lit], ["calleeThrows_copy", calleeThrows_copy], ["calleeThrows_call", calleeThrows_call], ["calleeThrows_new", calleeThrows_new], ["calleeThrows_seen", calleeThrows_seen]];

const twelve = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
for (const [name, f] of all) {
  say(name + " 3", () => f("x", "y", 3)); say(name + " 0", () => f()); say(name + " 1", () => f("x"));
  H.fn = f; say(name + " unknown", () => H.fn("x", "y", 3)); say(name + " apply", () => H.fn.apply(null, ["x", undefined])); say(name + " 12", () => H.fn(...twelve));
}

say("escapeOnOnePath_lit direct", () => S(escapeOnOnePath_lit("x", "y", 3)) + S(escapeOnOnePath_lit()) + S(escapeOnOnePath_lit(1.5, -0)));
say("escapeOnOnePath_copy direct", () => S(escapeOnOnePath_copy("x", "y", 3)) + S(escapeOnOnePath_copy()) + S(escapeOnOnePath_copy(1.5, -0)));
say("escapeOnOnePath_call direct", () => S(escapeOnOnePath_call("x", "y", 3)) + S(escapeOnOnePath_call()) + S(escapeOnOnePath_call(1.5, -0)));
say("escapeOnOnePath_new direct", () => S(escapeOnOnePath_new("x", "y", 3)) + S(escapeOnOnePath_new()) + S(escapeOnOnePath_new(1.5, -0)));
say("escapeOnOnePath_seen direct", () => S(escapeOnOnePath_seen("x", "y", 3)) + S(escapeOnOnePath_seen()) + S(escapeOnOnePath_seen(1.5, -0)));
say("spreadThenEscape_lit direct", () => S(spreadThenEscape_lit("x", "y", 3)) + S(spreadThenEscape_lit()) + S(spreadThenEscape_lit(1.5, -0)));
say("spreadThenEscape_copy direct", () => S(spreadThenEscape_copy("x", "y", 3)) + S(spreadThenEscape_copy()) + S(spreadThenEscape_copy(1.5, -0)));
say("spreadThenEscape_call direct", () => S(spreadThenEscape_call("x", "y", 3)) + S(spreadThenEscape_call()) + S(spreadThenEscape_call(1.5, -0)));
say("spreadThenEscape_new direct", () => S(spreadThenEscape_new("x", "y", 3)) + S(spreadThenEscape_new()) + S(spreadThenEscape_new(1.5, -0)));
say("spreadThenEscape_seen direct", () => S(spreadThenEscape_seen("x", "y", 3)) + S(spreadThenEscape_seen()) + S(spreadThenEscape_seen(1.5, -0)));
say("spreadThenEscapeThenChange_lit direct", () => S(spreadThenEscapeThenChange_lit("x", "y", 3)) + S(spreadThenEscapeThenChange_lit()) + S(spreadThenEscapeThenChange_lit(1.5, -0)));
say("spreadThenEscapeThenChange_copy direct", () => S(spreadThenEscapeThenChange_copy("x", "y", 3)) + S(spreadThenEscapeThenChange_copy()) + S(spreadThenEscapeThenChange_copy(1.5, -0)));
say("spreadThenEscapeThenChange_call direct", () => S(spreadThenEscapeThenChange_call("x", "y", 3)) + S(spreadThenEscapeThenChange_call()) + S(spreadThenEscapeThenChange_call(1.5, -0)));
say("spreadThenEscapeThenChange_new direct", () => S(spreadThenEscapeThenChange_new("x", "y", 3)) + S(spreadThenEscapeThenChange_new()) + S(spreadThenEscapeThenChange_new(1.5, -0)));
say("spreadThenEscapeThenChange_seen direct", () => S(spreadThenEscapeThenChange_seen("x", "y", 3)) + S(spreadThenEscapeThenChange_seen()) + S(spreadThenEscapeThenChange_seen(1.5, -0)));
say("escapeThenSpread_lit direct", () => S(escapeThenSpread_lit("x", "y", 3)) + S(escapeThenSpread_lit()) + S(escapeThenSpread_lit(1.5, -0)));
say("escapeThenSpread_copy direct", () => S(escapeThenSpread_copy("x", "y", 3)) + S(escapeThenSpread_copy()) + S(escapeThenSpread_copy(1.5, -0)));
say("escapeThenSpread_call direct", () => S(escapeThenSpread_call("x", "y", 3)) + S(escapeThenSpread_call()) + S(escapeThenSpread_call(1.5, -0)));
say("escapeThenSpread_new direct", () => S(escapeThenSpread_new("x", "y", 3)) + S(escapeThenSpread_new()) + S(escapeThenSpread_new(1.5, -0)));
say("escapeThenSpread_seen direct", () => S(escapeThenSpread_seen("x", "y", 3)) + S(escapeThenSpread_seen()) + S(escapeThenSpread_seen(1.5, -0)));
say("escapeInCondition_lit direct", () => S(escapeInCondition_lit("x", "y", 3)) + S(escapeInCondition_lit()) + S(escapeInCondition_lit(1.5, -0)));
say("escapeInCondition_copy direct", () => S(escapeInCondition_copy("x", "y", 3)) + S(escapeInCondition_copy()) + S(escapeInCondition_copy(1.5, -0)));
say("escapeInCondition_call direct", () => S(escapeInCondition_call("x", "y", 3)) + S(escapeInCondition_call()) + S(escapeInCondition_call(1.5, -0)));
say("escapeInCondition_new direct", () => S(escapeInCondition_new("x", "y", 3)) + S(escapeInCondition_new()) + S(escapeInCondition_new(1.5, -0)));
say("escapeInCondition_seen direct", () => S(escapeInCondition_seen("x", "y", 3)) + S(escapeInCondition_seen()) + S(escapeInCondition_seen(1.5, -0)));
say("storeInCondition_lit direct", () => S(storeInCondition_lit("x", "y", 3)) + S(storeInCondition_lit()) + S(storeInCondition_lit(1.5, -0)));
say("storeInCondition_copy direct", () => S(storeInCondition_copy("x", "y", 3)) + S(storeInCondition_copy()) + S(storeInCondition_copy(1.5, -0)));
say("storeInCondition_call direct", () => S(storeInCondition_call("x", "y", 3)) + S(storeInCondition_call()) + S(storeInCondition_call(1.5, -0)));
say("storeInCondition_new direct", () => S(storeInCondition_new("x", "y", 3)) + S(storeInCondition_new()) + S(storeInCondition_new(1.5, -0)));
say("storeInCondition_seen direct", () => S(storeInCondition_seen("x", "y", 3)) + S(storeInCondition_seen()) + S(storeInCondition_seen(1.5, -0)));
say("loopOfSpreads_lit direct", () => S(loopOfSpreads_lit("x", "y", 3)) + S(loopOfSpreads_lit()) + S(loopOfSpreads_lit(1.5, -0)));
say("loopOfSpreads_copy direct", () => S(loopOfSpreads_copy("x", "y", 3)) + S(loopOfSpreads_copy()) + S(loopOfSpreads_copy(1.5, -0)));
say("loopOfSpreads_call direct", () => S(loopOfSpreads_call("x", "y", 3)) + S(loopOfSpreads_call()) + S(loopOfSpreads_call(1.5, -0)));
say("loopOfSpreads_new direct", () => S(loopOfSpreads_new("x", "y", 3)) + S(loopOfSpreads_new()) + S(loopOfSpreads_new(1.5, -0)));
say("loopOfSpreads_seen direct", () => S(loopOfSpreads_seen("x", "y", 3)) + S(loopOfSpreads_seen()) + S(loopOfSpreads_seen(1.5, -0)));
say("loopSpreadAndEscape_lit direct", () => S(loopSpreadAndEscape_lit("x", "y", 3)) + S(loopSpreadAndEscape_lit()) + S(loopSpreadAndEscape_lit(1.5, -0)));
say("loopSpreadAndEscape_copy direct", () => S(loopSpreadAndEscape_copy("x", "y", 3)) + S(loopSpreadAndEscape_copy()) + S(loopSpreadAndEscape_copy(1.5, -0)));
say("loopSpreadAndEscape_call direct", () => S(loopSpreadAndEscape_call("x", "y", 3)) + S(loopSpreadAndEscape_call()) + S(loopSpreadAndEscape_call(1.5, -0)));
say("loopSpreadAndEscape_new direct", () => S(loopSpreadAndEscape_new("x", "y", 3)) + S(loopSpreadAndEscape_new()) + S(loopSpreadAndEscape_new(1.5, -0)));
say("loopSpreadAndEscape_seen direct", () => S(loopSpreadAndEscape_seen("x", "y", 3)) + S(loopSpreadAndEscape_seen()) + S(loopSpreadAndEscape_seen(1.5, -0)));
say("loopEscapeAtLast_lit direct", () => S(loopEscapeAtLast_lit("x", "y", 3)) + S(loopEscapeAtLast_lit()) + S(loopEscapeAtLast_lit(1.5, -0)));
say("loopEscapeAtLast_copy direct", () => S(loopEscapeAtLast_copy("x", "y", 3)) + S(loopEscapeAtLast_copy()) + S(loopEscapeAtLast_copy(1.5, -0)));
say("loopEscapeAtLast_call direct", () => S(loopEscapeAtLast_call("x", "y", 3)) + S(loopEscapeAtLast_call()) + S(loopEscapeAtLast_call(1.5, -0)));
say("loopEscapeAtLast_new direct", () => S(loopEscapeAtLast_new("x", "y", 3)) + S(loopEscapeAtLast_new()) + S(loopEscapeAtLast_new(1.5, -0)));
say("loopEscapeAtLast_seen direct", () => S(loopEscapeAtLast_seen("x", "y", 3)) + S(loopEscapeAtLast_seen()) + S(loopEscapeAtLast_seen(1.5, -0)));
say("loopEscapeFirst_lit direct", () => S(loopEscapeFirst_lit("x", "y", 3)) + S(loopEscapeFirst_lit()) + S(loopEscapeFirst_lit(1.5, -0)));
say("loopEscapeFirst_copy direct", () => S(loopEscapeFirst_copy("x", "y", 3)) + S(loopEscapeFirst_copy()) + S(loopEscapeFirst_copy(1.5, -0)));
say("loopEscapeFirst_call direct", () => S(loopEscapeFirst_call("x", "y", 3)) + S(loopEscapeFirst_call()) + S(loopEscapeFirst_call(1.5, -0)));
say("loopEscapeFirst_new direct", () => S(loopEscapeFirst_new("x", "y", 3)) + S(loopEscapeFirst_new()) + S(loopEscapeFirst_new(1.5, -0)));
say("loopEscapeFirst_seen direct", () => S(loopEscapeFirst_seen("x", "y", 3)) + S(loopEscapeFirst_seen()) + S(loopEscapeFirst_seen(1.5, -0)));
say("whileByLength_lit direct", () => S(whileByLength_lit("x", "y", 3)) + S(whileByLength_lit()) + S(whileByLength_lit(1.5, -0)));
say("whileByLength_copy direct", () => S(whileByLength_copy("x", "y", 3)) + S(whileByLength_copy()) + S(whileByLength_copy(1.5, -0)));
say("whileByLength_call direct", () => S(whileByLength_call("x", "y", 3)) + S(whileByLength_call()) + S(whileByLength_call(1.5, -0)));
say("whileByLength_new direct", () => S(whileByLength_new("x", "y", 3)) + S(whileByLength_new()) + S(whileByLength_new(1.5, -0)));
say("whileByLength_seen direct", () => S(whileByLength_seen("x", "y", 3)) + S(whileByLength_seen()) + S(whileByLength_seen(1.5, -0)));
say("finallyChanges_lit direct", () => S(finallyChanges_lit("x", "y", 3)) + S(finallyChanges_lit()) + S(finallyChanges_lit(1.5, -0)));
say("finallyChanges_copy direct", () => S(finallyChanges_copy("x", "y", 3)) + S(finallyChanges_copy()) + S(finallyChanges_copy(1.5, -0)));
say("finallyChanges_call direct", () => S(finallyChanges_call("x", "y", 3)) + S(finallyChanges_call()) + S(finallyChanges_call(1.5, -0)));
say("finallyChanges_new direct", () => S(finallyChanges_new("x", "y", 3)) + S(finallyChanges_new()) + S(finallyChanges_new(1.5, -0)));
say("finallyChanges_seen direct", () => S(finallyChanges_seen("x", "y", 3)) + S(finallyChanges_seen()) + S(finallyChanges_seen(1.5, -0)));
say("finallySpreads_lit direct", () => S(finallySpreads_lit("x", "y", 3)) + S(finallySpreads_lit()) + S(finallySpreads_lit(1.5, -0)));
say("finallySpreads_copy direct", () => S(finallySpreads_copy("x", "y", 3)) + S(finallySpreads_copy()) + S(finallySpreads_copy(1.5, -0)));
say("finallySpreads_call direct", () => S(finallySpreads_call("x", "y", 3)) + S(finallySpreads_call()) + S(finallySpreads_call(1.5, -0)));
say("finallySpreads_new direct", () => S(finallySpreads_new("x", "y", 3)) + S(finallySpreads_new()) + S(finallySpreads_new(1.5, -0)));
say("finallySpreads_seen direct", () => S(finallySpreads_seen("x", "y", 3)) + S(finallySpreads_seen()) + S(finallySpreads_seen(1.5, -0)));
say("catchStores_lit direct", () => S(catchStores_lit("x", "y", 3)) + S(catchStores_lit()) + S(catchStores_lit(1.5, -0)));
say("catchStores_copy direct", () => S(catchStores_copy("x", "y", 3)) + S(catchStores_copy()) + S(catchStores_copy(1.5, -0)));
say("catchStores_call direct", () => S(catchStores_call("x", "y", 3)) + S(catchStores_call()) + S(catchStores_call(1.5, -0)));
say("catchStores_new direct", () => S(catchStores_new("x", "y", 3)) + S(catchStores_new()) + S(catchStores_new(1.5, -0)));
say("catchStores_seen direct", () => S(catchStores_seen("x", "y", 3)) + S(catchStores_seen()) + S(catchStores_seen(1.5, -0)));
say("catchSpreads_lit direct", () => S(catchSpreads_lit("x", "y", 3)) + S(catchSpreads_lit()) + S(catchSpreads_lit(1.5, -0)));
say("catchSpreads_copy direct", () => S(catchSpreads_copy("x", "y", 3)) + S(catchSpreads_copy()) + S(catchSpreads_copy(1.5, -0)));
say("catchSpreads_call direct", () => S(catchSpreads_call("x", "y", 3)) + S(catchSpreads_call()) + S(catchSpreads_call(1.5, -0)));
say("catchSpreads_new direct", () => S(catchSpreads_new("x", "y", 3)) + S(catchSpreads_new()) + S(catchSpreads_new(1.5, -0)));
say("catchSpreads_seen direct", () => S(catchSpreads_seen("x", "y", 3)) + S(catchSpreads_seen()) + S(catchSpreads_seen(1.5, -0)));
say("throwsBetween_lit direct", () => S(throwsBetween_lit("x", "y", 3)) + S(throwsBetween_lit()) + S(throwsBetween_lit(1.5, -0)));
say("throwsBetween_copy direct", () => S(throwsBetween_copy("x", "y", 3)) + S(throwsBetween_copy()) + S(throwsBetween_copy(1.5, -0)));
say("throwsBetween_call direct", () => S(throwsBetween_call("x", "y", 3)) + S(throwsBetween_call()) + S(throwsBetween_call(1.5, -0)));
say("throwsBetween_new direct", () => S(throwsBetween_new("x", "y", 3)) + S(throwsBetween_new()) + S(throwsBetween_new(1.5, -0)));
say("throwsBetween_seen direct", () => S(throwsBetween_seen("x", "y", 3)) + S(throwsBetween_seen()) + S(throwsBetween_seen(1.5, -0)));
say("spreadIntoThrower_lit direct", () => S(spreadIntoThrower_lit("x", "y", 3)) + S(spreadIntoThrower_lit()) + S(spreadIntoThrower_lit(1.5, -0)));
say("spreadIntoThrower_copy direct", () => S(spreadIntoThrower_copy("x", "y", 3)) + S(spreadIntoThrower_copy()) + S(spreadIntoThrower_copy(1.5, -0)));
say("spreadIntoThrower_call direct", () => S(spreadIntoThrower_call("x", "y", 3)) + S(spreadIntoThrower_call()) + S(spreadIntoThrower_call(1.5, -0)));
say("spreadIntoThrower_new direct", () => S(spreadIntoThrower_new("x", "y", 3)) + S(spreadIntoThrower_new()) + S(spreadIntoThrower_new(1.5, -0)));
say("spreadIntoThrower_seen direct", () => S(spreadIntoThrower_seen("x", "y", 3)) + S(spreadIntoThrower_seen()) + S(spreadIntoThrower_seen(1.5, -0)));
say("switchFallsThrough_lit direct", () => S(switchFallsThrough_lit("x", "y", 3)) + S(switchFallsThrough_lit()) + S(switchFallsThrough_lit(1.5, -0)));
say("switchFallsThrough_copy direct", () => S(switchFallsThrough_copy("x", "y", 3)) + S(switchFallsThrough_copy()) + S(switchFallsThrough_copy(1.5, -0)));
say("switchFallsThrough_call direct", () => S(switchFallsThrough_call("x", "y", 3)) + S(switchFallsThrough_call()) + S(switchFallsThrough_call(1.5, -0)));
say("switchFallsThrough_new direct", () => S(switchFallsThrough_new("x", "y", 3)) + S(switchFallsThrough_new()) + S(switchFallsThrough_new(1.5, -0)));
say("switchFallsThrough_seen direct", () => S(switchFallsThrough_seen("x", "y", 3)) + S(switchFallsThrough_seen()) + S(switchFallsThrough_seen(1.5, -0)));
say("labelledBreak_lit direct", () => S(labelledBreak_lit("x", "y", 3)) + S(labelledBreak_lit()) + S(labelledBreak_lit(1.5, -0)));
say("labelledBreak_copy direct", () => S(labelledBreak_copy("x", "y", 3)) + S(labelledBreak_copy()) + S(labelledBreak_copy(1.5, -0)));
say("labelledBreak_call direct", () => S(labelledBreak_call("x", "y", 3)) + S(labelledBreak_call()) + S(labelledBreak_call(1.5, -0)));
say("labelledBreak_new direct", () => S(labelledBreak_new("x", "y", 3)) + S(labelledBreak_new()) + S(labelledBreak_new(1.5, -0)));
say("labelledBreak_seen direct", () => S(labelledBreak_seen("x", "y", 3)) + S(labelledBreak_seen()) + S(labelledBreak_seen(1.5, -0)));
say("objectAndSpread_lit direct", () => S(objectAndSpread_lit("x", "y", 3)) + S(objectAndSpread_lit()) + S(objectAndSpread_lit(1.5, -0)));
say("objectAndSpread_copy direct", () => S(objectAndSpread_copy("x", "y", 3)) + S(objectAndSpread_copy()) + S(objectAndSpread_copy(1.5, -0)));
say("objectAndSpread_call direct", () => S(objectAndSpread_call("x", "y", 3)) + S(objectAndSpread_call()) + S(objectAndSpread_call(1.5, -0)));
say("objectAndSpread_new direct", () => S(objectAndSpread_new("x", "y", 3)) + S(objectAndSpread_new()) + S(objectAndSpread_new(1.5, -0)));
say("objectAndSpread_seen direct", () => S(objectAndSpread_seen("x", "y", 3)) + S(objectAndSpread_seen()) + S(objectAndSpread_seen(1.5, -0)));
say("spreadAndObject_lit direct", () => S(spreadAndObject_lit("x", "y", 3)) + S(spreadAndObject_lit()) + S(spreadAndObject_lit(1.5, -0)));
say("spreadAndObject_copy direct", () => S(spreadAndObject_copy("x", "y", 3)) + S(spreadAndObject_copy()) + S(spreadAndObject_copy(1.5, -0)));
say("spreadAndObject_call direct", () => S(spreadAndObject_call("x", "y", 3)) + S(spreadAndObject_call()) + S(spreadAndObject_call(1.5, -0)));
say("spreadAndObject_new direct", () => S(spreadAndObject_new("x", "y", 3)) + S(spreadAndObject_new()) + S(spreadAndObject_new(1.5, -0)));
say("spreadAndObject_seen direct", () => S(spreadAndObject_seen("x", "y", 3)) + S(spreadAndObject_seen()) + S(spreadAndObject_seen(1.5, -0)));
say("sameObjectTwice_lit direct", () => S(sameObjectTwice_lit("x", "y", 3)) + S(sameObjectTwice_lit()) + S(sameObjectTwice_lit(1.5, -0)));
say("sameObjectTwice_copy direct", () => S(sameObjectTwice_copy("x", "y", 3)) + S(sameObjectTwice_copy()) + S(sameObjectTwice_copy(1.5, -0)));
say("sameObjectTwice_call direct", () => S(sameObjectTwice_call("x", "y", 3)) + S(sameObjectTwice_call()) + S(sameObjectTwice_call(1.5, -0)));
say("sameObjectTwice_new direct", () => S(sameObjectTwice_new("x", "y", 3)) + S(sameObjectTwice_new()) + S(sameObjectTwice_new(1.5, -0)));
say("sameObjectTwice_seen direct", () => S(sameObjectTwice_seen("x", "y", 3)) + S(sameObjectTwice_seen()) + S(sameObjectTwice_seen(1.5, -0)));
say("escapesOnTwoPaths_lit direct", () => S(escapesOnTwoPaths_lit("x", "y", 3)) + S(escapesOnTwoPaths_lit()) + S(escapesOnTwoPaths_lit(1.5, -0)));
say("escapesOnTwoPaths_copy direct", () => S(escapesOnTwoPaths_copy("x", "y", 3)) + S(escapesOnTwoPaths_copy()) + S(escapesOnTwoPaths_copy(1.5, -0)));
say("escapesOnTwoPaths_call direct", () => S(escapesOnTwoPaths_call("x", "y", 3)) + S(escapesOnTwoPaths_call()) + S(escapesOnTwoPaths_call(1.5, -0)));
say("escapesOnTwoPaths_new direct", () => S(escapesOnTwoPaths_new("x", "y", 3)) + S(escapesOnTwoPaths_new()) + S(escapesOnTwoPaths_new(1.5, -0)));
say("escapesOnTwoPaths_seen direct", () => S(escapesOnTwoPaths_seen("x", "y", 3)) + S(escapesOnTwoPaths_seen()) + S(escapesOnTwoPaths_seen(1.5, -0)));
say("returned_lit direct", () => S(returned_lit("x", "y", 3)) + S(returned_lit()) + S(returned_lit(1.5, -0)));
say("returned_copy direct", () => S(returned_copy("x", "y", 3)) + S(returned_copy()) + S(returned_copy(1.5, -0)));
say("returned_call direct", () => S(returned_call("x", "y", 3)) + S(returned_call()) + S(returned_call(1.5, -0)));
say("returned_new direct", () => S(returned_new("x", "y", 3)) + S(returned_new()) + S(returned_new(1.5, -0)));
say("returned_seen direct", () => S(returned_seen("x", "y", 3)) + S(returned_seen()) + S(returned_seen(1.5, -0)));
say("throughVariable_lit direct", () => S(throughVariable_lit("x", "y", 3)) + S(throughVariable_lit()) + S(throughVariable_lit(1.5, -0)));
say("throughVariable_copy direct", () => S(throughVariable_copy("x", "y", 3)) + S(throughVariable_copy()) + S(throughVariable_copy(1.5, -0)));
say("throughVariable_call direct", () => S(throughVariable_call("x", "y", 3)) + S(throughVariable_call()) + S(throughVariable_call(1.5, -0)));
say("throughVariable_new direct", () => S(throughVariable_new("x", "y", 3)) + S(throughVariable_new()) + S(throughVariable_new(1.5, -0)));
say("throughVariable_seen direct", () => S(throughVariable_seen("x", "y", 3)) + S(throughVariable_seen()) + S(throughVariable_seen(1.5, -0)));
say("throughChoice_lit direct", () => S(throughChoice_lit("x", "y", 3)) + S(throughChoice_lit()) + S(throughChoice_lit(1.5, -0)));
say("throughChoice_copy direct", () => S(throughChoice_copy("x", "y", 3)) + S(throughChoice_copy()) + S(throughChoice_copy(1.5, -0)));
say("throughChoice_call direct", () => S(throughChoice_call("x", "y", 3)) + S(throughChoice_call()) + S(throughChoice_call(1.5, -0)));
say("throughChoice_new direct", () => S(throughChoice_new("x", "y", 3)) + S(throughChoice_new()) + S(throughChoice_new(1.5, -0)));
say("throughChoice_seen direct", () => S(throughChoice_seen("x", "y", 3)) + S(throughChoice_seen()) + S(throughChoice_seen(1.5, -0)));
say("twice_lit direct", () => S(twice_lit("x", "y", 3)) + S(twice_lit()) + S(twice_lit(1.5, -0)));
say("twice_copy direct", () => S(twice_copy("x", "y", 3)) + S(twice_copy()) + S(twice_copy(1.5, -0)));
say("twice_call direct", () => S(twice_call("x", "y", 3)) + S(twice_call()) + S(twice_call(1.5, -0)));
say("twice_new direct", () => S(twice_new("x", "y", 3)) + S(twice_new()) + S(twice_new(1.5, -0)));
say("twice_seen direct", () => S(twice_seen("x", "y", 3)) + S(twice_seen()) + S(twice_seen(1.5, -0)));
say("nested_lit direct", () => S(nested_lit("x", "y", 3)) + S(nested_lit()) + S(nested_lit(1.5, -0)));
say("nested_copy direct", () => S(nested_copy("x", "y", 3)) + S(nested_copy()) + S(nested_copy(1.5, -0)));
say("nested_call direct", () => S(nested_call("x", "y", 3)) + S(nested_call()) + S(nested_call(1.5, -0)));
say("nested_new direct", () => S(nested_new("x", "y", 3)) + S(nested_new()) + S(nested_new(1.5, -0)));
say("nested_seen direct", () => S(nested_seen("x", "y", 3)) + S(nested_seen()) + S(nested_seen(1.5, -0)));
say("deleteAhead_lit direct", () => S(deleteAhead_lit("x", "y", 3)) + S(deleteAhead_lit()) + S(deleteAhead_lit(1.5, -0)));
say("deleteAhead_copy direct", () => S(deleteAhead_copy("x", "y", 3)) + S(deleteAhead_copy()) + S(deleteAhead_copy(1.5, -0)));
say("deleteAhead_call direct", () => S(deleteAhead_call("x", "y", 3)) + S(deleteAhead_call()) + S(deleteAhead_call(1.5, -0)));
say("deleteAhead_new direct", () => S(deleteAhead_new("x", "y", 3)) + S(deleteAhead_new()) + S(deleteAhead_new(1.5, -0)));
say("deleteAhead_seen direct", () => S(deleteAhead_seen("x", "y", 3)) + S(deleteAhead_seen()) + S(deleteAhead_seen(1.5, -0)));
say("deleteBehind_lit direct", () => S(deleteBehind_lit("x", "y", 3)) + S(deleteBehind_lit()) + S(deleteBehind_lit(1.5, -0)));
say("deleteBehind_copy direct", () => S(deleteBehind_copy("x", "y", 3)) + S(deleteBehind_copy()) + S(deleteBehind_copy(1.5, -0)));
say("deleteBehind_call direct", () => S(deleteBehind_call("x", "y", 3)) + S(deleteBehind_call()) + S(deleteBehind_call(1.5, -0)));
say("deleteBehind_new direct", () => S(deleteBehind_new("x", "y", 3)) + S(deleteBehind_new()) + S(deleteBehind_new(1.5, -0)));
say("deleteBehind_seen direct", () => S(deleteBehind_seen("x", "y", 3)) + S(deleteBehind_seen()) + S(deleteBehind_seen(1.5, -0)));
say("asksIn_lit direct", () => S(asksIn_lit("x", "y", 3)) + S(asksIn_lit()) + S(asksIn_lit(1.5, -0)));
say("asksIn_copy direct", () => S(asksIn_copy("x", "y", 3)) + S(asksIn_copy()) + S(asksIn_copy(1.5, -0)));
say("asksIn_call direct", () => S(asksIn_call("x", "y", 3)) + S(asksIn_call()) + S(asksIn_call(1.5, -0)));
say("asksIn_new direct", () => S(asksIn_new("x", "y", 3)) + S(asksIn_new()) + S(asksIn_new(1.5, -0)));
say("asksIn_seen direct", () => S(asksIn_seen("x", "y", 3)) + S(asksIn_seen()) + S(asksIn_seen(1.5, -0)));
say("keys_lit direct", () => S(keys_lit("x", "y", 3)) + S(keys_lit()) + S(keys_lit(1.5, -0)));
say("keys_copy direct", () => S(keys_copy("x", "y", 3)) + S(keys_copy()) + S(keys_copy(1.5, -0)));
say("keys_call direct", () => S(keys_call("x", "y", 3)) + S(keys_call()) + S(keys_call(1.5, -0)));
say("keys_new direct", () => S(keys_new("x", "y", 3)) + S(keys_new()) + S(keys_new(1.5, -0)));
say("keys_seen direct", () => S(keys_seen("x", "y", 3)) + S(keys_seen()) + S(keys_seen(1.5, -0)));
say("objectSpread_lit direct", () => S(objectSpread_lit("x", "y", 3)) + S(objectSpread_lit()) + S(objectSpread_lit(1.5, -0)));
say("objectSpread_copy direct", () => S(objectSpread_copy("x", "y", 3)) + S(objectSpread_copy()) + S(objectSpread_copy(1.5, -0)));
say("objectSpread_call direct", () => S(objectSpread_call("x", "y", 3)) + S(objectSpread_call()) + S(objectSpread_call(1.5, -0)));
say("objectSpread_new direct", () => S(objectSpread_new("x", "y", 3)) + S(objectSpread_new()) + S(objectSpread_new(1.5, -0)));
say("objectSpread_seen direct", () => S(objectSpread_seen("x", "y", 3)) + S(objectSpread_seen()) + S(objectSpread_seen(1.5, -0)));
say("pattern_lit direct", () => S(pattern_lit("x", "y", 3)) + S(pattern_lit()) + S(pattern_lit(1.5, -0)));
say("pattern_copy direct", () => S(pattern_copy("x", "y", 3)) + S(pattern_copy()) + S(pattern_copy(1.5, -0)));
say("pattern_call direct", () => S(pattern_call("x", "y", 3)) + S(pattern_call()) + S(pattern_call(1.5, -0)));
say("pattern_new direct", () => S(pattern_new("x", "y", 3)) + S(pattern_new()) + S(pattern_new(1.5, -0)));
say("pattern_seen direct", () => S(pattern_seen("x", "y", 3)) + S(pattern_seen()) + S(pattern_seen(1.5, -0)));
say("patternStores_lit direct", () => S(patternStores_lit("x", "y", 3)) + S(patternStores_lit()) + S(patternStores_lit(1.5, -0)));
say("patternStores_copy direct", () => S(patternStores_copy("x", "y", 3)) + S(patternStores_copy()) + S(patternStores_copy(1.5, -0)));
say("patternStores_call direct", () => S(patternStores_call("x", "y", 3)) + S(patternStores_call()) + S(patternStores_call(1.5, -0)));
say("patternStores_new direct", () => S(patternStores_new("x", "y", 3)) + S(patternStores_new()) + S(patternStores_new(1.5, -0)));
say("patternStores_seen direct", () => S(patternStores_seen("x", "y", 3)) + S(patternStores_seen()) + S(patternStores_seen(1.5, -0)));
say("forOf_lit direct", () => S(forOf_lit("x", "y", 3)) + S(forOf_lit()) + S(forOf_lit(1.5, -0)));
say("forOf_copy direct", () => S(forOf_copy("x", "y", 3)) + S(forOf_copy()) + S(forOf_copy(1.5, -0)));
say("forOf_call direct", () => S(forOf_call("x", "y", 3)) + S(forOf_call()) + S(forOf_call(1.5, -0)));
say("forOf_new direct", () => S(forOf_new("x", "y", 3)) + S(forOf_new()) + S(forOf_new(1.5, -0)));
say("forOf_seen direct", () => S(forOf_seen("x", "y", 3)) + S(forOf_seen()) + S(forOf_seen(1.5, -0)));
say("forOfStores_lit direct", () => S(forOfStores_lit("x", "y", 3)) + S(forOfStores_lit()) + S(forOfStores_lit(1.5, -0)));
say("forOfStores_copy direct", () => S(forOfStores_copy("x", "y", 3)) + S(forOfStores_copy()) + S(forOfStores_copy(1.5, -0)));
say("forOfStores_call direct", () => S(forOfStores_call("x", "y", 3)) + S(forOfStores_call()) + S(forOfStores_call(1.5, -0)));
say("forOfStores_new direct", () => S(forOfStores_new("x", "y", 3)) + S(forOfStores_new()) + S(forOfStores_new(1.5, -0)));
say("forOfStores_seen direct", () => S(forOfStores_seen("x", "y", 3)) + S(forOfStores_seen()) + S(forOfStores_seen(1.5, -0)));
say("forIn_lit direct", () => S(forIn_lit("x", "y", 3)) + S(forIn_lit()) + S(forIn_lit(1.5, -0)));
say("forIn_copy direct", () => S(forIn_copy("x", "y", 3)) + S(forIn_copy()) + S(forIn_copy(1.5, -0)));
say("forIn_call direct", () => S(forIn_call("x", "y", 3)) + S(forIn_call()) + S(forIn_call(1.5, -0)));
say("forIn_new direct", () => S(forIn_new("x", "y", 3)) + S(forIn_new()) + S(forIn_new(1.5, -0)));
say("forIn_seen direct", () => S(forIn_seen("x", "y", 3)) + S(forIn_seen()) + S(forIn_seen(1.5, -0)));
say("typeofIt_lit direct", () => S(typeofIt_lit("x", "y", 3)) + S(typeofIt_lit()) + S(typeofIt_lit(1.5, -0)));
say("typeofIt_copy direct", () => S(typeofIt_copy("x", "y", 3)) + S(typeofIt_copy()) + S(typeofIt_copy(1.5, -0)));
say("typeofIt_call direct", () => S(typeofIt_call("x", "y", 3)) + S(typeofIt_call()) + S(typeofIt_call(1.5, -0)));
say("typeofIt_new direct", () => S(typeofIt_new("x", "y", 3)) + S(typeofIt_new()) + S(typeofIt_new(1.5, -0)));
say("typeofIt_seen direct", () => S(typeofIt_seen("x", "y", 3)) + S(typeofIt_seen()) + S(typeofIt_seen(1.5, -0)));
say("tag_lit direct", () => S(tag_lit("x", "y", 3)) + S(tag_lit()) + S(tag_lit(1.5, -0)));
say("tag_copy direct", () => S(tag_copy("x", "y", 3)) + S(tag_copy()) + S(tag_copy(1.5, -0)));
say("tag_call direct", () => S(tag_call("x", "y", 3)) + S(tag_call()) + S(tag_call(1.5, -0)));
say("tag_new direct", () => S(tag_new("x", "y", 3)) + S(tag_new()) + S(tag_new(1.5, -0)));
say("tag_seen direct", () => S(tag_seen("x", "y", 3)) + S(tag_seen()) + S(tag_seen(1.5, -0)));
say("byName_lit direct", () => S(byName_lit("x", "y", 3)) + S(byName_lit()) + S(byName_lit(1.5, -0)));
say("byName_copy direct", () => S(byName_copy("x", "y", 3)) + S(byName_copy()) + S(byName_copy(1.5, -0)));
say("byName_call direct", () => S(byName_call("x", "y", 3)) + S(byName_call()) + S(byName_call(1.5, -0)));
say("byName_new direct", () => S(byName_new("x", "y", 3)) + S(byName_new()) + S(byName_new(1.5, -0)));
say("byName_seen direct", () => S(byName_seen("x", "y", 3)) + S(byName_seen()) + S(byName_seen(1.5, -0)));
say("oddKeys_lit direct", () => S(oddKeys_lit("x", "y", 3)) + S(oddKeys_lit()) + S(oddKeys_lit(1.5, -0)));
say("oddKeys_copy direct", () => S(oddKeys_copy("x", "y", 3)) + S(oddKeys_copy()) + S(oddKeys_copy(1.5, -0)));
say("oddKeys_call direct", () => S(oddKeys_call("x", "y", 3)) + S(oddKeys_call()) + S(oddKeys_call(1.5, -0)));
say("oddKeys_new direct", () => S(oddKeys_new("x", "y", 3)) + S(oddKeys_new()) + S(oddKeys_new(1.5, -0)));
say("oddKeys_seen direct", () => S(oddKeys_seen("x", "y", 3)) + S(oddKeys_seen()) + S(oddKeys_seen(1.5, -0)));
say("noPrototype_lit direct", () => S(noPrototype_lit("x", "y", 3)) + S(noPrototype_lit()) + S(noPrototype_lit(1.5, -0)));
say("noPrototype_copy direct", () => S(noPrototype_copy("x", "y", 3)) + S(noPrototype_copy()) + S(noPrototype_copy(1.5, -0)));
say("noPrototype_call direct", () => S(noPrototype_call("x", "y", 3)) + S(noPrototype_call()) + S(noPrototype_call(1.5, -0)));
say("noPrototype_new direct", () => S(noPrototype_new("x", "y", 3)) + S(noPrototype_new()) + S(noPrototype_new(1.5, -0)));
say("noPrototype_seen direct", () => S(noPrototype_seen("x", "y", 3)) + S(noPrototype_seen()) + S(noPrototype_seen(1.5, -0)));
say("compound_lit direct", () => S(compound_lit("x", "y", 3)) + S(compound_lit()) + S(compound_lit(1.5, -0)));
say("compound_copy direct", () => S(compound_copy("x", "y", 3)) + S(compound_copy()) + S(compound_copy(1.5, -0)));
say("compound_call direct", () => S(compound_call("x", "y", 3)) + S(compound_call()) + S(compound_call(1.5, -0)));
say("compound_new direct", () => S(compound_new("x", "y", 3)) + S(compound_new()) + S(compound_new(1.5, -0)));
say("compound_seen direct", () => S(compound_seen("x", "y", 3)) + S(compound_seen()) + S(compound_seen(1.5, -0)));
say("lengthCompound_lit direct", () => S(lengthCompound_lit("x", "y", 3)) + S(lengthCompound_lit()) + S(lengthCompound_lit(1.5, -0)));
say("lengthCompound_copy direct", () => S(lengthCompound_copy("x", "y", 3)) + S(lengthCompound_copy()) + S(lengthCompound_copy(1.5, -0)));
say("lengthCompound_call direct", () => S(lengthCompound_call("x", "y", 3)) + S(lengthCompound_call()) + S(lengthCompound_call(1.5, -0)));
say("lengthCompound_new direct", () => S(lengthCompound_new("x", "y", 3)) + S(lengthCompound_new()) + S(lengthCompound_new(1.5, -0)));
say("lengthCompound_seen direct", () => S(lengthCompound_seen("x", "y", 3)) + S(lengthCompound_seen()) + S(lengthCompound_seen(1.5, -0)));
say("lengthZero_lit direct", () => S(lengthZero_lit("x", "y", 3)) + S(lengthZero_lit()) + S(lengthZero_lit(1.5, -0)));
say("lengthZero_copy direct", () => S(lengthZero_copy("x", "y", 3)) + S(lengthZero_copy()) + S(lengthZero_copy(1.5, -0)));
say("lengthZero_call direct", () => S(lengthZero_call("x", "y", 3)) + S(lengthZero_call()) + S(lengthZero_call(1.5, -0)));
say("lengthZero_new direct", () => S(lengthZero_new("x", "y", 3)) + S(lengthZero_new()) + S(lengthZero_new(1.5, -0)));
say("lengthZero_seen direct", () => S(lengthZero_seen("x", "y", 3)) + S(lengthZero_seen()) + S(lengthZero_seen(1.5, -0)));
say("lengthOdd_lit direct", () => S(lengthOdd_lit("x", "y", 3)) + S(lengthOdd_lit()) + S(lengthOdd_lit(1.5, -0)));
say("lengthOdd_copy direct", () => S(lengthOdd_copy("x", "y", 3)) + S(lengthOdd_copy()) + S(lengthOdd_copy(1.5, -0)));
say("lengthOdd_call direct", () => S(lengthOdd_call("x", "y", 3)) + S(lengthOdd_call()) + S(lengthOdd_call(1.5, -0)));
say("lengthOdd_new direct", () => S(lengthOdd_new("x", "y", 3)) + S(lengthOdd_new()) + S(lengthOdd_new(1.5, -0)));
say("lengthOdd_seen direct", () => S(lengthOdd_seen("x", "y", 3)) + S(lengthOdd_seen()) + S(lengthOdd_seen(1.5, -0)));
say("named_lit direct", () => S(named_lit("x", "y", 3)) + S(named_lit()) + S(named_lit(1.5, -0)));
say("named_copy direct", () => S(named_copy("x", "y", 3)) + S(named_copy()) + S(named_copy(1.5, -0)));
say("named_call direct", () => S(named_call("x", "y", 3)) + S(named_call()) + S(named_call(1.5, -0)));
say("named_new direct", () => S(named_new("x", "y", 3)) + S(named_new()) + S(named_new(1.5, -0)));
say("named_seen direct", () => S(named_seen("x", "y", 3)) + S(named_seen()) + S(named_seen(1.5, -0)));
say("closureStores_lit direct", () => S(closureStores_lit("x", "y", 3)) + S(closureStores_lit()) + S(closureStores_lit(1.5, -0)));
say("closureStores_copy direct", () => S(closureStores_copy("x", "y", 3)) + S(closureStores_copy()) + S(closureStores_copy(1.5, -0)));
say("closureStores_call direct", () => S(closureStores_call("x", "y", 3)) + S(closureStores_call()) + S(closureStores_call(1.5, -0)));
say("closureStores_new direct", () => S(closureStores_new("x", "y", 3)) + S(closureStores_new()) + S(closureStores_new(1.5, -0)));
say("closureStores_seen direct", () => S(closureStores_seen("x", "y", 3)) + S(closureStores_seen()) + S(closureStores_seen(1.5, -0)));
say("closureKeeps_lit direct", () => S(closureKeeps_lit("x", "y", 3)) + S(closureKeeps_lit()) + S(closureKeeps_lit(1.5, -0)));
say("closureKeeps_copy direct", () => S(closureKeeps_copy("x", "y", 3)) + S(closureKeeps_copy()) + S(closureKeeps_copy(1.5, -0)));
say("closureKeeps_call direct", () => S(closureKeeps_call("x", "y", 3)) + S(closureKeeps_call()) + S(closureKeeps_call(1.5, -0)));
say("closureKeeps_new direct", () => S(closureKeeps_new("x", "y", 3)) + S(closureKeeps_new()) + S(closureKeeps_new(1.5, -0)));
say("closureKeeps_seen direct", () => S(closureKeeps_seen("x", "y", 3)) + S(closureKeeps_seen()) + S(closureKeeps_seen(1.5, -0)));
say("closureSpreads_lit direct", () => S(closureSpreads_lit("x", "y", 3)) + S(closureSpreads_lit()) + S(closureSpreads_lit(1.5, -0)));
say("closureSpreads_copy direct", () => S(closureSpreads_copy("x", "y", 3)) + S(closureSpreads_copy()) + S(closureSpreads_copy(1.5, -0)));
say("closureSpreads_call direct", () => S(closureSpreads_call("x", "y", 3)) + S(closureSpreads_call()) + S(closureSpreads_call(1.5, -0)));
say("closureSpreads_new direct", () => S(closureSpreads_new("x", "y", 3)) + S(closureSpreads_new()) + S(closureSpreads_new(1.5, -0)));
say("closureSpreads_seen direct", () => S(closureSpreads_seen("x", "y", 3)) + S(closureSpreads_seen()) + S(closureSpreads_seen(1.5, -0)));
say("closureHandedOn_lit direct", () => S(closureHandedOn_lit("x", "y", 3)) + S(closureHandedOn_lit()) + S(closureHandedOn_lit(1.5, -0)));
say("closureHandedOn_copy direct", () => S(closureHandedOn_copy("x", "y", 3)) + S(closureHandedOn_copy()) + S(closureHandedOn_copy(1.5, -0)));
say("closureHandedOn_call direct", () => S(closureHandedOn_call("x", "y", 3)) + S(closureHandedOn_call()) + S(closureHandedOn_call(1.5, -0)));
say("closureHandedOn_new direct", () => S(closureHandedOn_new("x", "y", 3)) + S(closureHandedOn_new()) + S(closureHandedOn_new(1.5, -0)));
say("closureHandedOn_seen direct", () => S(closureHandedOn_seen("x", "y", 3)) + S(closureHandedOn_seen()) + S(closureHandedOn_seen(1.5, -0)));
say("arrayFrom_lit direct", () => S(arrayFrom_lit("x", "y", 3)) + S(arrayFrom_lit()) + S(arrayFrom_lit(1.5, -0)));
say("arrayFrom_copy direct", () => S(arrayFrom_copy("x", "y", 3)) + S(arrayFrom_copy()) + S(arrayFrom_copy(1.5, -0)));
say("arrayFrom_call direct", () => S(arrayFrom_call("x", "y", 3)) + S(arrayFrom_call()) + S(arrayFrom_call(1.5, -0)));
say("arrayFrom_new direct", () => S(arrayFrom_new("x", "y", 3)) + S(arrayFrom_new()) + S(arrayFrom_new(1.5, -0)));
say("arrayFrom_seen direct", () => S(arrayFrom_seen("x", "y", 3)) + S(arrayFrom_seen()) + S(arrayFrom_seen(1.5, -0)));
say("slice_lit direct", () => S(slice_lit("x", "y", 3)) + S(slice_lit()) + S(slice_lit(1.5, -0)));
say("slice_copy direct", () => S(slice_copy("x", "y", 3)) + S(slice_copy()) + S(slice_copy(1.5, -0)));
say("slice_call direct", () => S(slice_call("x", "y", 3)) + S(slice_call()) + S(slice_call(1.5, -0)));
say("slice_new direct", () => S(slice_new("x", "y", 3)) + S(slice_new()) + S(slice_new(1.5, -0)));
say("slice_seen direct", () => S(slice_seen("x", "y", 3)) + S(slice_seen()) + S(slice_seen(1.5, -0)));
say("applyToo_lit direct", () => S(applyToo_lit("x", "y", 3)) + S(applyToo_lit()) + S(applyToo_lit(1.5, -0)));
say("applyToo_copy direct", () => S(applyToo_copy("x", "y", 3)) + S(applyToo_copy()) + S(applyToo_copy(1.5, -0)));
say("applyToo_call direct", () => S(applyToo_call("x", "y", 3)) + S(applyToo_call()) + S(applyToo_call(1.5, -0)));
say("applyToo_new direct", () => S(applyToo_new("x", "y", 3)) + S(applyToo_new()) + S(applyToo_new(1.5, -0)));
say("applyToo_seen direct", () => S(applyToo_seen("x", "y", 3)) + S(applyToo_seen()) + S(applyToo_seen(1.5, -0)));
say("json_lit direct", () => S(json_lit("x", "y", 3)) + S(json_lit()) + S(json_lit(1.5, -0)));
say("json_copy direct", () => S(json_copy("x", "y", 3)) + S(json_copy()) + S(json_copy(1.5, -0)));
say("json_call direct", () => S(json_call("x", "y", 3)) + S(json_call()) + S(json_call(1.5, -0)));
say("json_new direct", () => S(json_new("x", "y", 3)) + S(json_new()) + S(json_new(1.5, -0)));
say("json_seen direct", () => S(json_seen("x", "y", 3)) + S(json_seen()) + S(json_seen(1.5, -0)));
say("accessorBehind_lit direct", () => S(accessorBehind_lit("x", "y", 3)) + S(accessorBehind_lit()) + S(accessorBehind_lit(1.5, -0)));
say("accessorBehind_copy direct", () => S(accessorBehind_copy("x", "y", 3)) + S(accessorBehind_copy()) + S(accessorBehind_copy(1.5, -0)));
say("accessorBehind_call direct", () => S(accessorBehind_call("x", "y", 3)) + S(accessorBehind_call()) + S(accessorBehind_call(1.5, -0)));
say("accessorBehind_new direct", () => S(accessorBehind_new("x", "y", 3)) + S(accessorBehind_new()) + S(accessorBehind_new(1.5, -0)));
say("accessorBehind_seen direct", () => S(accessorBehind_seen("x", "y", 3)) + S(accessorBehind_seen()) + S(accessorBehind_seen(1.5, -0)));
say("namedParameters_lit direct", () => S(namedParameters_lit("x", "y", 3)) + S(namedParameters_lit()) + S(namedParameters_lit(1.5, -0)));
say("namedParameters_copy direct", () => S(namedParameters_copy("x", "y", 3)) + S(namedParameters_copy()) + S(namedParameters_copy(1.5, -0)));
say("namedParameters_call direct", () => S(namedParameters_call("x", "y", 3)) + S(namedParameters_call()) + S(namedParameters_call(1.5, -0)));
say("namedParameters_new direct", () => S(namedParameters_new("x", "y", 3)) + S(namedParameters_new()) + S(namedParameters_new(1.5, -0)));
say("namedParameters_seen direct", () => S(namedParameters_seen("x", "y", 3)) + S(namedParameters_seen()) + S(namedParameters_seen(1.5, -0)));
say("ownRest_lit direct", () => S(ownRest_lit("x", "y", 3)) + S(ownRest_lit()) + S(ownRest_lit(1.5, -0)));
say("ownRest_copy direct", () => S(ownRest_copy("x", "y", 3)) + S(ownRest_copy()) + S(ownRest_copy(1.5, -0)));
say("ownRest_call direct", () => S(ownRest_call("x", "y", 3)) + S(ownRest_call()) + S(ownRest_call(1.5, -0)));
say("ownRest_new direct", () => S(ownRest_new("x", "y", 3)) + S(ownRest_new()) + S(ownRest_new(1.5, -0)));
say("ownRest_seen direct", () => S(ownRest_seen("x", "y", 3)) + S(ownRest_seen()) + S(ownRest_seen(1.5, -0)));
say("onlyRest_lit direct", () => S(onlyRest_lit("x", "y", 3)) + S(onlyRest_lit()) + S(onlyRest_lit(1.5, -0)));
say("onlyRest_copy direct", () => S(onlyRest_copy("x", "y", 3)) + S(onlyRest_copy()) + S(onlyRest_copy(1.5, -0)));
say("onlyRest_call direct", () => S(onlyRest_call("x", "y", 3)) + S(onlyRest_call()) + S(onlyRest_call(1.5, -0)));
say("onlyRest_new direct", () => S(onlyRest_new("x", "y", 3)) + S(onlyRest_new()) + S(onlyRest_new(1.5, -0)));
say("onlyRest_seen direct", () => S(onlyRest_seen("x", "y", 3)) + S(onlyRest_seen()) + S(onlyRest_seen(1.5, -0)));
say("restSorted_lit direct", () => S(restSorted_lit("x", "y", 3)) + S(restSorted_lit()) + S(restSorted_lit(1.5, -0)));
say("restSorted_copy direct", () => S(restSorted_copy("x", "y", 3)) + S(restSorted_copy()) + S(restSorted_copy(1.5, -0)));
say("restSorted_call direct", () => S(restSorted_call("x", "y", 3)) + S(restSorted_call()) + S(restSorted_call(1.5, -0)));
say("restSorted_new direct", () => S(restSorted_new("x", "y", 3)) + S(restSorted_new()) + S(restSorted_new(1.5, -0)));
say("restSorted_seen direct", () => S(restSorted_seen("x", "y", 3)) + S(restSorted_seen()) + S(restSorted_seen(1.5, -0)));
say("defaultReads_lit direct", () => S(defaultReads_lit("x", "y", 3)) + S(defaultReads_lit()) + S(defaultReads_lit(1.5, -0)));
say("defaultReads_copy direct", () => S(defaultReads_copy("x", "y", 3)) + S(defaultReads_copy()) + S(defaultReads_copy(1.5, -0)));
say("defaultReads_call direct", () => S(defaultReads_call("x", "y", 3)) + S(defaultReads_call()) + S(defaultReads_call(1.5, -0)));
say("defaultReads_new direct", () => S(defaultReads_new("x", "y", 3)) + S(defaultReads_new()) + S(defaultReads_new(1.5, -0)));
say("defaultReads_seen direct", () => S(defaultReads_seen("x", "y", 3)) + S(defaultReads_seen()) + S(defaultReads_seen(1.5, -0)));
say("defaultStores_lit direct", () => S(defaultStores_lit("x", "y", 3)) + S(defaultStores_lit()) + S(defaultStores_lit(1.5, -0)));
say("defaultStores_copy direct", () => S(defaultStores_copy("x", "y", 3)) + S(defaultStores_copy()) + S(defaultStores_copy(1.5, -0)));
say("defaultStores_call direct", () => S(defaultStores_call("x", "y", 3)) + S(defaultStores_call()) + S(defaultStores_call(1.5, -0)));
say("defaultStores_new direct", () => S(defaultStores_new("x", "y", 3)) + S(defaultStores_new()) + S(defaultStores_new(1.5, -0)));
say("defaultStores_seen direct", () => S(defaultStores_seen("x", "y", 3)) + S(defaultStores_seen()) + S(defaultStores_seen(1.5, -0)));
say("destructured_lit direct", () => S(destructured_lit("x", "y", 3)) + S(destructured_lit()) + S(destructured_lit(1.5, -0)));
say("destructured_copy direct", () => S(destructured_copy("x", "y", 3)) + S(destructured_copy()) + S(destructured_copy(1.5, -0)));
say("destructured_call direct", () => S(destructured_call("x", "y", 3)) + S(destructured_call()) + S(destructured_call(1.5, -0)));
say("destructured_new direct", () => S(destructured_new("x", "y", 3)) + S(destructured_new()) + S(destructured_new(1.5, -0)));
say("destructured_seen direct", () => S(destructured_seen("x", "y", 3)) + S(destructured_seen()) + S(destructured_seen(1.5, -0)));
say("recursive_lit direct", () => S(recursive_lit("x", "y", 3)) + S(recursive_lit()) + S(recursive_lit(1.5, -0)));
say("recursive_copy direct", () => S(recursive_copy("x", "y", 3)) + S(recursive_copy()) + S(recursive_copy(1.5, -0)));
say("recursive_call direct", () => S(recursive_call("x", "y", 3)) + S(recursive_call()) + S(recursive_call(1.5, -0)));
say("recursive_new direct", () => S(recursive_new("x", "y", 3)) + S(recursive_new()) + S(recursive_new(1.5, -0)));
say("recursive_seen direct", () => S(recursive_seen("x", "y", 3)) + S(recursive_seen()) + S(recursive_seen(1.5, -0)));
say("callsItself_lit direct", () => S(callsItself_lit("x", "y", 3)) + S(callsItself_lit()) + S(callsItself_lit(1.5, -0)));
say("callsItself_copy direct", () => S(callsItself_copy("x", "y", 3)) + S(callsItself_copy()) + S(callsItself_copy(1.5, -0)));
say("callsItself_call direct", () => S(callsItself_call("x", "y", 3)) + S(callsItself_call()) + S(callsItself_call(1.5, -0)));
say("callsItself_new direct", () => S(callsItself_new("x", "y", 3)) + S(callsItself_new()) + S(callsItself_new(1.5, -0)));
say("callsItself_seen direct", () => S(callsItself_seen("x", "y", 3)) + S(callsItself_seen()) + S(callsItself_seen(1.5, -0)));
say("sealed_lit direct", () => S(sealed_lit("x", "y", 3)) + S(sealed_lit()) + S(sealed_lit(1.5, -0)));
say("sealed_copy direct", () => S(sealed_copy("x", "y", 3)) + S(sealed_copy()) + S(sealed_copy(1.5, -0)));
say("sealed_call direct", () => S(sealed_call("x", "y", 3)) + S(sealed_call()) + S(sealed_call(1.5, -0)));
say("sealed_new direct", () => S(sealed_new("x", "y", 3)) + S(sealed_new()) + S(sealed_new(1.5, -0)));
say("sealed_seen direct", () => S(sealed_seen("x", "y", 3)) + S(sealed_seen()) + S(sealed_seen(1.5, -0)));
say("assigned_lit direct", () => S(assigned_lit("x", "y", 3)) + S(assigned_lit()) + S(assigned_lit(1.5, -0)));
say("assigned_copy direct", () => S(assigned_copy("x", "y", 3)) + S(assigned_copy()) + S(assigned_copy(1.5, -0)));
say("assigned_call direct", () => S(assigned_call("x", "y", 3)) + S(assigned_call()) + S(assigned_call(1.5, -0)));
say("assigned_new direct", () => S(assigned_new("x", "y", 3)) + S(assigned_new()) + S(assigned_new(1.5, -0)));
say("assigned_seen direct", () => S(assigned_seen("x", "y", 3)) + S(assigned_seen()) + S(assigned_seen(1.5, -0)));
say("calleeThrows_lit direct", () => S(calleeThrows_lit("x", "y", 3)) + S(calleeThrows_lit()) + S(calleeThrows_lit(1.5, -0)));
say("calleeThrows_copy direct", () => S(calleeThrows_copy("x", "y", 3)) + S(calleeThrows_copy()) + S(calleeThrows_copy(1.5, -0)));
say("calleeThrows_call direct", () => S(calleeThrows_call("x", "y", 3)) + S(calleeThrows_call()) + S(calleeThrows_call(1.5, -0)));
say("calleeThrows_new direct", () => S(calleeThrows_new("x", "y", 3)) + S(calleeThrows_new()) + S(calleeThrows_new(1.5, -0)));
say("calleeThrows_seen direct", () => S(calleeThrows_seen("x", "y", 3)) + S(calleeThrows_seen()) + S(calleeThrows_seen(1.5, -0)));

// The caller's own array changes while the callee runs.
let shared;
const spoil = () => { if (shared.length) shared[0] = "spoiled"; shared.length = 0; shared.push("pushed", "pushed"); };
H.spoil = spoil;
function spoiled_lit() { H.spoil(); return [0, ...arguments]; }
function spoiledInline_lit() { if (shared.length) shared[0] = "spoiled"; shared.length = 0; shared.push("pushed"); return [0, ...arguments]; }
function spoiled_copy() { H.spoil(); return [...arguments]; }
function spoiledInline_copy() { if (shared.length) shared[0] = "spoiled"; shared.length = 0; shared.push("pushed"); return [...arguments]; }
function spoiled_call() { H.spoil(); return H.id(0, ...arguments); }
function spoiledInline_call() { if (shared.length) shared[0] = "spoiled"; shared.length = 0; shared.push("pushed"); return H.id(0, ...arguments); }
function spoiled_new() { H.spoil(); return new H.K(0, ...arguments).a; }
function spoiledInline_new() { if (shared.length) shared[0] = "spoiled"; shared.length = 0; shared.push("pushed"); return new H.K(0, ...arguments).a; }
function spoiled_seen() { H.spoil(); return H.id(...arguments); }
function spoiledInline_seen() { if (shared.length) shared[0] = "spoiled"; shared.length = 0; shared.push("pushed"); return H.id(...arguments); }
function spoiled_reads() { H.spoil(); return [arguments.length, arguments[0], arguments[arguments.length - 1]]; }
function spoiledInline_reads() { if (shared.length) shared[0] = "spoiled"; shared.length = 0; shared.push("pushed"); return [arguments.length, arguments[0], arguments[arguments.length - 1]]; }
function spoiled_slice() { H.spoil(); return Array.prototype.slice.call(arguments); }
function spoiledInline_slice() { if (shared.length) shared[0] = "spoiled"; shared.length = 0; shared.push("pushed"); return Array.prototype.slice.call(arguments); }
const changing = [["spoiled_lit", spoiled_lit], ["spoiledInline_lit", spoiledInline_lit], ["spoiled_copy", spoiled_copy], ["spoiledInline_copy", spoiledInline_copy], ["spoiled_call", spoiled_call], ["spoiledInline_call", spoiledInline_call], ["spoiled_new", spoiled_new], ["spoiledInline_new", spoiledInline_new], ["spoiled_seen", spoiled_seen], ["spoiledInline_seen", spoiledInline_seen], ["spoiled_reads", spoiled_reads], ["spoiledInline_reads", spoiledInline_reads], ["spoiled_slice", spoiled_slice], ["spoiledInline_slice", spoiledInline_slice]];
const makers = { texts: n => Array.from({ length: n }, (x, i) => "a" + i), wholes: n => Array.from({ length: n }, (x, i) => i), halves: n => Array.from({ length: n }, (x, i) => i + 0.5) };
for (const [name, f] of changing) for (const [made, make] of Object.entries(makers)) {
  let line = "";
  for (const n of [0, 1, 2, 4, 6, 7, 8, 9, 10, 17, 40, 300]) {
    shared = make(n); line += " " + S(f(...shared)).length; shared = make(n); line += "," + S(f.apply(null, shared)).length; shared = make(n); line += "," + S(Reflect.apply(f, null, shared)).length;
    shared = make(n); H.fn = f; const r = H.fn(...shared); line += "," + (r.length ? one(r[r.length - 1]) : "-") + (r.includes("spoiled") || r.includes("pushed") ? " SEES THE CHANGE" : "");
  }
  say(name + " " + made, () => line);
}

// A suspension between the entry and the spread.
const waiting = [], late = [];
function* gen_lit() { yield 1; yield [0, ...arguments]; arguments[0] = "stored"; yield [0, ...arguments]; }
function* genOnly_lit(a) { a = yield [0, ...arguments]; yield [a, ...[0, ...arguments]]; }
async function asy_lit() { await null; const r = [0, ...arguments]; await null; return S(r) + S([0, ...arguments]); }
async function* agen_lit() { yield [0, ...arguments]; await null; yield [0, ...arguments]; }
say("generator lit", () => { shared = ["g1", "g2"]; const g = gen_lit(...shared); g.next(); H.spoil(); return S(g.next().value) + S(g.next().value); });
say("generator alone lit", () => { const g = genOnly_lit("p", "q"); return S(g.next().value) + S(g.next("sent").value); });
{ shared = ["s1", "s2"]; const p = asy_lit(...shared); H.spoil(); waiting.push(p.then(v => late.push("async lit: " + v))); }
{ const g = agen_lit("t1", "t2"); waiting.push(g.next().then(a => g.next().then(b => late.push("async generator lit: " + S(a.value) + S(b.value))))); }
function* gen_copy() { yield 1; yield [...arguments]; arguments[0] = "stored"; yield [...arguments]; }
function* genOnly_copy(a) { a = yield [...arguments]; yield [a, ...[...arguments]]; }
async function asy_copy() { await null; const r = [...arguments]; await null; return S(r) + S([...arguments]); }
async function* agen_copy() { yield [...arguments]; await null; yield [...arguments]; }
say("generator copy", () => { shared = ["g1", "g2"]; const g = gen_copy(...shared); g.next(); H.spoil(); return S(g.next().value) + S(g.next().value); });
say("generator alone copy", () => { const g = genOnly_copy("p", "q"); return S(g.next().value) + S(g.next("sent").value); });
{ shared = ["s1", "s2"]; const p = asy_copy(...shared); H.spoil(); waiting.push(p.then(v => late.push("async copy: " + v))); }
{ const g = agen_copy("t1", "t2"); waiting.push(g.next().then(a => g.next().then(b => late.push("async generator copy: " + S(a.value) + S(b.value))))); }
function* gen_call() { yield 1; yield H.id(0, ...arguments); arguments[0] = "stored"; yield H.id(0, ...arguments); }
function* genOnly_call(a) { a = yield H.id(0, ...arguments); yield [a, ...H.id(0, ...arguments)]; }
async function asy_call() { await null; const r = H.id(0, ...arguments); await null; return S(r) + S(H.id(0, ...arguments)); }
async function* agen_call() { yield H.id(0, ...arguments); await null; yield H.id(0, ...arguments); }
say("generator call", () => { shared = ["g1", "g2"]; const g = gen_call(...shared); g.next(); H.spoil(); return S(g.next().value) + S(g.next().value); });
say("generator alone call", () => { const g = genOnly_call("p", "q"); return S(g.next().value) + S(g.next("sent").value); });
{ shared = ["s1", "s2"]; const p = asy_call(...shared); H.spoil(); waiting.push(p.then(v => late.push("async call: " + v))); }
{ const g = agen_call("t1", "t2"); waiting.push(g.next().then(a => g.next().then(b => late.push("async generator call: " + S(a.value) + S(b.value))))); }
function* gen_new() { yield 1; yield new H.K(0, ...arguments).a; arguments[0] = "stored"; yield new H.K(0, ...arguments).a; }
function* genOnly_new(a) { a = yield new H.K(0, ...arguments).a; yield [a, ...new H.K(0, ...arguments).a]; }
async function asy_new() { await null; const r = new H.K(0, ...arguments).a; await null; return S(r) + S(new H.K(0, ...arguments).a); }
async function* agen_new() { yield new H.K(0, ...arguments).a; await null; yield new H.K(0, ...arguments).a; }
say("generator new", () => { shared = ["g1", "g2"]; const g = gen_new(...shared); g.next(); H.spoil(); return S(g.next().value) + S(g.next().value); });
say("generator alone new", () => { const g = genOnly_new("p", "q"); return S(g.next().value) + S(g.next("sent").value); });
{ shared = ["s1", "s2"]; const p = asy_new(...shared); H.spoil(); waiting.push(p.then(v => late.push("async new: " + v))); }
{ const g = agen_new("t1", "t2"); waiting.push(g.next().then(a => g.next().then(b => late.push("async generator new: " + S(a.value) + S(b.value))))); }
function* gen_seen() { yield 1; yield H.id(...arguments); arguments[0] = "stored"; yield H.id(...arguments); }
function* genOnly_seen(a) { a = yield H.id(...arguments); yield [a, ...H.id(...arguments)]; }
async function asy_seen() { await null; const r = H.id(...arguments); await null; return S(r) + S(H.id(...arguments)); }
async function* agen_seen() { yield H.id(...arguments); await null; yield H.id(...arguments); }
say("generator seen", () => { shared = ["g1", "g2"]; const g = gen_seen(...shared); g.next(); H.spoil(); return S(g.next().value) + S(g.next().value); });
say("generator alone seen", () => { const g = genOnly_seen("p", "q"); return S(g.next().value) + S(g.next("sent").value); });
{ shared = ["s1", "s2"]; const p = asy_seen(...shared); H.spoil(); waiting.push(p.then(v => late.push("async seen: " + v))); }
{ const g = agen_seen("t1", "t2"); waiting.push(g.next().then(a => g.next().then(b => late.push("async generator seen: " + S(a.value) + S(b.value))))); }

// Classes, methods, accessors, constructors.
class Base { constructor(...a) { this.a = a; } m(...a) { return a; } static s(...a) { return a; } }
class D1 extends Base { constructor() { super(0, ...arguments); } m() { return super.m(0, ...arguments); } static s() { return super.s(0, ...arguments); } get g() { return [0, ...arguments]; } set v(x) { H.set = [0, ...arguments]; } }
class D2 extends Base { constructor() { super(...arguments); this.b = [0, ...arguments]; } }
class D3 extends Base { constructor(a) { const r = [0, ...arguments]; super(...r, ...arguments); this.c = new.target === D3; } }
class D4 extends Base { constructor() { arguments[0] = "stored"; super(0, ...arguments); } }
class D5 extends Base { field = "f"; constructor() { super(0, ...arguments); this.d = [this.field, ...arguments]; } }
say("super behind", () => S(new D1(1, 2).a) + S(new D1().a) + S(new D1(...twelve).a));
say("super method", () => S(new D1().m(1, 2)) + S(D1.s(1, 2)) + S(new D1().g)); say("setter", () => { new D1().v = "set"; return H.set; });
say("super then spread", () => { const d = new D2(1, 2); return S(d.a) + S(d.b); }); say("spread then super", () => { const d = new D3(1, 2); return S(d.a) + d.c; });
say("stored then super", () => S(new D4(1, 2).a)); say("with a field", () => { const d = new D5(1, 2); return S(d.a) + S(d.d); });
function Old() { this.a = [0, ...arguments]; this.n = new.target === Old; } say("an old constructor", () => { const o = new Old(1, 2); return S(o.a) + o.n + S(Reflect.construct(Old, [3]).a); });
const literal = { m() { return [0, ...arguments]; }, get g() { return [0, ...arguments]; }, f: function () { return H.id(0, ...arguments); }, ["c" + 1]() { return new H.K(0, ...arguments).a; } };
say("methods of a literal", () => S(literal.m(1, 2)) + S(literal.g) + S(literal.f(1)) + S(literal.c1(1, 2, 3)));

// Called by native code.
const counts = function () { return [0, ...arguments].length; }; const shows = function () { return S([0, ...arguments].slice(0, 3)); };
say("map", () => [5, 6].map(counts)); say("forEach", () => { let r = ""; [5, 6].forEach(function () { r += S(H.id(0, ...arguments).slice(0, 3)); }); return r; });
say("replace", () => "abc".replace(/(b)/, shows)); say("sort", () => { let n = 0; [3, 1, 2].sort(function () { n += [0, ...arguments].length; return arguments[0] - arguments[1]; }); return n > 0; });
say("reviver", () => { const seen = []; JSON.parse('{"a":1}', function () { seen.push([0, ...arguments].length); return arguments[1]; }); return seen; });
say("executor", () => { let n; new Promise(function () { n = [0, ...arguments].length; }); return n; }); say("Array.from", () => Array.from({ length: 2 }, shows));
say("bound", () => shows.bind(null, "b1", "b2")(1) + counts.bind(null, 1, 2, 3, 4, 5, 6, 7, 8, 9)(10)); say("proxy", () => new Proxy(shows, {})(1, 2)); say("call", () => shows.call(null, 1, 2) + shows.call());
say("reduce", () => [1, 2, 3].reduce(function () { return [0, ...arguments].length; })); say("toString", () => `${{ toString() { return S([0, ...arguments]); } }}`);
say("getter by Reflect", () => Reflect.get({ get g() { return [0, ...arguments]; } }, "g")); say("Symbol.toPrimitive", () => +{ [Symbol.toPrimitive]() { return [0, ...arguments].length; } });

// Many.
for (const n of [13, 64, 65, 127, 128, 129, 1000, 10000]) say("many " + n, () => { const l = Array.from({ length: n }, (x, i) => i); const a = (function () { return [0, ...arguments]; })(...l), b = (function () { return H.id(0, ...arguments); })(...l), c = (function () { return [...arguments, ...arguments]; }).apply(null, l); return a.length + "," + a[n] + "," + b.length + "," + b[n] + "," + c.length + "," + c[2 * n - 1]; });
await Promise.all(waiting); for (const line of late) console.log(line);
console.log("done");

