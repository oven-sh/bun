// -1, 1.5, 4294967295 and their like name properties of an array, no elements. Such a data property is stored, read back, tested for, listed, copied, updated and deleted, as in plain Bun, and a validating build has nothing to find: the array keeps what is proven of its names and of its storage.
// Flags: --aot-validate
function show(what, f) { let last; for (let round = 0; round < 300; round++) last = f(); console.log(what, JSON.stringify(last)); }
for (const key of [-1, 1.5, 4294967295, -0.5, 1e21, NaN, Infinity]) {
  show("literal, read back " + key, () => { const a = [1, 2, 3]; a[key] = 5; return [a[key], a.length]; });
  show("in " + key, () => { const a = [1, 2, 3]; a[key] = 5; return [key in a, String(key) in a, Object.hasOwn(a, key)]; });
  show("keys " + key, () => { const a = [1, 2, 3]; a[key] = 5; return [Object.keys(a), Object.getOwnPropertyNames(a).length]; });
  show("for-in " + key, () => { const a = [1, 2, 3]; a[key] = 5; const seen = []; for (const k in a) seen.push(k); return seen; });
  show("entries " + key, () => { const a = [1, 2, 3]; a[key] = 5; return Object.entries(a); });
  show("spread into an object " + key, () => { const a = [1, 2, 3]; a[key] = 5; return { ...a }; });
  show("assign " + key, () => { const a = [1, 2, 3]; a[key] = 5; return Object.assign({}, a); });
  show("delete " + key, () => { const a = [1, 2, 3]; a[key] = 5; const gone = delete a[key]; return [gone, a[key], key in a]; });
  show("update " + key, () => { const a = [1, 2, 3]; a[key] = 5; a[key] += 2; a[key]++; return a[key]; });
}
show("constant -1", () => { const a = [1, 2, 3]; a[-1] = 5; return [a[-1], -1 in a, Object.keys(a), a.at(-1)]; });
show("constant 1.5", () => { const a = [1, 2, 3]; a[1.5] = 5; return [a[1.5], 1.5 in a, Object.keys(a)]; });
show("a loop that runs below zero", () => { const a = [1, 2, 3]; for (let i = 2; i >= -2; i--) a[i] = i; let sum = 0; for (let i = 2; i >= -2; i--) sum += a[i]; return [sum, a.length, Object.keys(a)]; });
show("handed to a function", () => { const a = [1, 2, 3]; (function (list, at) { list[at] = 9; })(a, -1); return [a[-1], Object.keys(a)]; });
show("an accessor under -1", () => { const a = [1, 2, 3]; Object.defineProperty(a, -1, { get() { return "got"; }, configurable: true }); return [a[-1], a.length]; });
