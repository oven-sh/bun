// RUN: lower
// OPTIONS: builtin-modules

// Behind a frozen built-in object the engine asks where it otherwise knows the answer: a built-in then calls other built-ins (the getter of Symbol.species, the constructor, `then`, `has` and `keys`). That is no code of the program.
try { Object.freeze(Promise.prototype); console.log("changed"); } catch (e) { console.log("refused", e.name); }
try { console.log([].concat([1, , 3], [4]).length); } catch (e) { console.log("throws", e.name); }
try { console.log([1].concat(2, [3]).join()); } catch (e) { console.log("throws", e.name); }
try { console.log([1, , 3].slice(1).length); } catch (e) { console.log("throws", e.name); }
try { console.log([1, , 3].filter(() => true).join()); } catch (e) { console.log("throws", e.name); }
try { console.log([1, 2].map(x => x * 2).join()); } catch (e) { console.log("throws", e.name); }
try { console.log([1, 2, 3].splice(1, 1).join()); } catch (e) { console.log("throws", e.name); }
try { console.log([[1], [2]].flat().join()); } catch (e) { console.log("throws", e.name); }
try { console.log([1, 2].flatMap(x => [x, x]).join()); } catch (e) { console.log("throws", e.name); }
try { console.log(typeof Promise.resolve(1).then(x => x)); } catch (e) { console.log("throws", e.name); }
try { console.log(typeof Promise.resolve(1).finally(() => {})); } catch (e) { console.log("throws", e.name); }
try { console.log(typeof Promise.all([1])); } catch (e) { console.log("throws", e.name); }
try { console.log("bab".split(/a/).length); } catch (e) { console.log("throws", e.name); }
try { console.log([..."bab".matchAll(/a/g)].length); } catch (e) { console.log("throws", e.name); }
try { console.log("bab".replace(/a/, "c")); } catch (e) { console.log("throws", e.name); }
try { console.log(new Uint8Array([1, 2]).slice(1).length); } catch (e) { console.log("throws", e.name); }
try { console.log(new Uint8Array([1, 2]).map(x => x * 2).join()); } catch (e) { console.log("throws", e.name); }
try { console.log(new Uint8Array([1, 2]).subarray(1).length); } catch (e) { console.log("throws", e.name); }
try { console.log(new Uint8Array([1, 2]).filter(x => x > 1).length); } catch (e) { console.log("throws", e.name); }
try { console.log(new ArrayBuffer(4).slice(1).byteLength); } catch (e) { console.log("throws", e.name); }
try { console.log(new Set([1]).union(new Set([2])).size); } catch (e) { console.log("throws", e.name); }
try { console.log(new Map([[1, 2]]).size); } catch (e) { console.log("throws", e.name); }
try { console.log(Array.from([1, 2]).length); } catch (e) { console.log("throws", e.name); }
try { console.log(Array.of(1, 2).length); } catch (e) { console.log("throws", e.name); }
try { console.log([3, 1, 2].toSorted().join()); } catch (e) { console.log("throws", e.name); }
try { console.log(Object.groupBy([1], x => "k").k.length); } catch (e) { console.log("throws", e.name); }
try { console.log(structuredClone([1, 2]).length); } catch (e) { console.log("throws", e.name); }
try { console.log(JSON.parse("[1,2]").length); } catch (e) { console.log("throws", e.name); }
try { console.log([1, 2].with(0, 5).join()); } catch (e) { console.log("throws", e.name); }
