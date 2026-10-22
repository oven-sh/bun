// The way of core-js: install({ target, proto }, members) finds the object by a computed name on globalThis and puts the members there; the program then calls them by name and hands them a callback.
// The code at the top asks a caught value for its prototype: with that the built-in objects are in hands nobody follows when the install is looked at, and the compiler once lost the members: the callback "was not compiled".
function show(value) {
  if (typeof value !== "object" || value === null) return String(value);
  return Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name;
}
let line;
try { line = show([1, { a: 2 }]); } catch (error) { line = "threw " + show(error); }
console.log(line);
function install({ target, proto, global }, members) {
  const holder = global ? globalThis : globalThis[target];
  const object = proto ? holder.prototype : holder;
  for (const [key, member] of Object.entries(members)) object[key] = member;
}
install({ target: "Array", proto: true }, {
  byTheProgram0(callback) { return "installed " + callback(typeof this, 1); },
});
try { console.log("entries array-prototype", [1, 2, 3].byTheProgram0((kind, one) => kind + " " + (one + 1))); } catch (error) { console.log("entries array-prototype", "threw", error.name); }
install({ target: "String", proto: true }, {
  byTheProgram1(callback) { return "installed " + callback(typeof this, 1); },
});
try { console.log("entries string-prototype", "abc".byTheProgram1((kind, one) => kind + " " + (one + 1))); } catch (error) { console.log("entries string-prototype", "threw", error.name); }
install({ target: "Map", proto: true }, {
  byTheProgram2(callback) { return "installed " + callback(typeof this, 1); },
});
try { console.log("entries map-prototype", new Map([[1, 2]]).byTheProgram2((kind, one) => kind + " " + (one + 1))); } catch (error) { console.log("entries map-prototype", "threw", error.name); }
install({ target: "Set", proto: true }, {
  byTheProgram3(callback) { return "installed " + callback(typeof this, 1); },
});
try { console.log("entries set-prototype", new Set([1]).byTheProgram3((kind, one) => kind + " " + (one + 1))); } catch (error) { console.log("entries set-prototype", "threw", error.name); }
install({ target: "Number", proto: true }, {
  byTheProgram6(callback) { return "installed " + callback(typeof this, 1); },
});
try { console.log("entries number-prototype", (5).byTheProgram6((kind, one) => kind + " " + (one + 1))); } catch (error) { console.log("entries number-prototype", "threw", error.name); }
install({ target: "Error", proto: true }, {
  byTheProgram8(callback) { return "installed " + callback(typeof this, 1); },
});
try { console.log("entries error-prototype", new Error("e").byTheProgram8((kind, one) => kind + " " + (one + 1))); } catch (error) { console.log("entries error-prototype", "threw", error.name); }
install({ target: "Array" }, {
  byTheProgram9(callback) { return "installed " + callback(typeof this, 1); },
});
try { console.log("entries array", Array.byTheProgram9((kind, one) => kind + " " + (one + 1))); } catch (error) { console.log("entries array", "threw", error.name); }
install({ target: "Object" }, {
  byTheProgram10(callback) { return "installed " + callback(typeof this, 1); },
});
try { console.log("entries object", Object.byTheProgram10((kind, one) => kind + " " + (one + 1))); } catch (error) { console.log("entries object", "threw", error.name); }
install({ target: "Math" }, {
  byTheProgram11(callback) { return "installed " + callback(typeof this, 1); },
});
try { console.log("entries math", Math.byTheProgram11((kind, one) => kind + " " + (one + 1))); } catch (error) { console.log("entries math", "threw", error.name); }
install({ target: "JSON" }, {
  byTheProgram12(callback) { return "installed " + callback(typeof this, 1); },
});
try { console.log("entries json", JSON.byTheProgram12((kind, one) => kind + " " + (one + 1))); } catch (error) { console.log("entries json", "threw", error.name); }
install({ target: "Reflect" }, {
  byTheProgram13(callback) { return "installed " + callback(typeof this, 1); },
});
try { console.log("entries reflect", Reflect.byTheProgram13((kind, one) => kind + " " + (one + 1))); } catch (error) { console.log("entries reflect", "threw", error.name); }
install({ global: true }, {
  byTheProgram14(callback) { return "installed " + callback(typeof this, 1); },
});
try { console.log("entries global", globalThis.byTheProgram14((kind, one) => kind + " " + (one + 1))); } catch (error) { console.log("entries global", "threw", error.name); }
install({ global: true }, {
  byTheProgram15(callback) { return "installed " + callback(typeof this, 1); },
});
try { console.log("entries global-free-name", byTheProgram15((kind, one) => kind + " " + (one + 1))); } catch (error) { console.log("entries global-free-name", "threw", error.name); }
