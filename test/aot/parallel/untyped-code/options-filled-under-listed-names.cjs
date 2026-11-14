// Literals that a loop fills with the names of a record in a variable, which other code has too: read, stored, deleted, redefined, listed and copied under those names.
const out = [];
const show = (v) => typeof v === "function" ? "fn" : typeof v === "object" && v ? JSON.stringify(v) : String(v);
const tell = (f) => { try { out.push(show(f())); } catch (e) { out.push(e.constructor.name); } };
const library = {};
(function (exports) {
    const hasOwn = Object.hasOwn;
    var defaults = { version: null, kind: "script", locations: false, ranges: false, onToken: null, "a-b": 1, get: 2, limit: 3 };
    function fill(given) { var options = {}; for (var name in defaults) options[name] = given && hasOwn(given, name) ? given[name] : defaults[name]; if (options.version == null) options.version = 11; return options; }
    function fillKeys(given) { const options = { first: 0 }; for (const name of Object.keys(defaults)) options[name] = given && name in given ? given[name] : defaults[name]; return options; }
    function fillSome(given) { const options = Object.create(null); for (const name in defaults) if (name !== "ranges") options[name] = given[name]; return options; }
    function Reader(given, filler) { this.options = given = filler(given); this.sum = 0; }
    Reader.prototype.step = function () { if (this.options.locations) this.sum += 1; if (this.options.ranges) this.sum += 10; return this.options.limit; };
    Reader.prototype.run = function (n) { let last; for (let i = 0; i < n; i++) last = this.step(); return [last, this.sum, this.options.kind, this.options["a-b"], this.options.get, this.options.version]; };
    exports.defaults = defaults; exports.fill = fill; exports.fillKeys = fillKeys; exports.fillSome = fillSome; exports.Reader = Reader;
})(library);
const { Reader, fill, fillKeys, fillSome, defaults } = library;
const given = [undefined, null, {}, { locations: true }, { locations: 1, ranges: "r", other: 5 }, { limit: { deep: 1 } }, { version: 2020, kind: undefined }, Object.create({ locations: true }), new Proxy({ ranges: true }, {}), [1, 2]];
function all(tag) {
    for (const filler of [fill, fillKeys, fillSome]) for (const g of given) tell(() => { const r = new Reader(g, filler); return [r.run(1), r.run(30), Object.keys(r.options).join(), r.options]; });
    out.push(tag);
}
all("as written");
tell(() => { const r = new Reader({}, fill); r.options.locations = { on: 1 }; r.options.limit = 1.5; delete r.options.ranges; return [r.run(5), "ranges" in r.options, Object.keys(r.options).join()]; });
tell(() => { const r = new Reader({}, fill); delete r.options.locations; r.options.locations = 1; r.options.late = 2; return [r.run(5), Object.keys(r.options).join()]; });
tell(() => { const r = new Reader({}, fill); let n = 0; Object.defineProperty(r.options, "locations", { get() { n++; return true; } }); return [r.run(5), n, Object.keys(r.options).join()]; });
tell(() => { const r = new Reader({}, fillKeys); Object.freeze(r.options); try { r.options.limit = 9; return "silent"; } catch (e) { return [e.constructor.name, r.run(3)]; } });
tell(() => { const r = new Reader({}, fill); Object.setPrototypeOf(r.options, { ranges: true, limit: "above" }); delete r.options.ranges; delete r.options.limit; return r.run(4); });
tell(() => { const { version, kind, ...rest } = fill({ limit: 4 }); return [version, kind, rest, { ...fillKeys({}) }, Object.assign({ z: 1 }, fill())]; });
tell(() => { const o = fill({}); for (const k in o) o[k] = k; o[7] = "seven"; return [o, o.locations, Object.entries(o).length]; });
defaults.added = 1; delete defaults.kind; all("a name more, one less");
Object.defineProperty(defaults, "limit", { get() { out.push("asked"); return 5; }, enumerable: true, configurable: true }); tell(() => new Reader({}, fill).run(2));
Object.defineProperty(defaults, "locations", { enumerable: false }); tell(() => [new Reader({}, fill).run(2), Object.keys(fill()).join()]);
for (let i = 0; i < 60; i++) defaults["n" + i] = i; tell(() => [new Reader({ n7: "given" }, fill).run(2), Object.keys(fillKeys()).length, fill().n59]);
Object.setPrototypeOf(defaults, { above: 1, ranges: "hidden" }); tell(() => [fill().above, fill().ranges, Object.keys(fillKeys()).includes("above")]);
for (const line of out) console.log(line);
