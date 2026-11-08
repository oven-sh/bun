const report = value => console.log(typeof value === "string" ? value : String(value));
// Generated: classes that share a prototype object, a kind of cell or a row of classes, each asked about the values of all.
const show = (value) => value === true ? "1" : value === false ? "0" : String(value);
function attempt(act) { try { return act(); } catch (error) { return "T"; } }
function maybe(name, make, values) { try { values.push([name, make()]); } catch (error) { values.push([name + ", which cannot be made: " + error.name, undefined]); } }

function isBlob(x) { return x instanceof Blob; }
function countBlob(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Blob) count++; } return count; }
function isFile(x) { return x instanceof File; }
function countFile(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof File) count++; } return count; }
const tests = [["Blob", isBlob, countBlob], ["File", isFile, countFile]];
const values = [];
maybe("created below Blob.prototype", () => Object.create(Blob.prototype), values);
maybe("Blob.prototype", () => Blob.prototype, values);
maybe("Blob", () => Blob, values);
maybe("new Blob", () => new Blob(["a"]), values);
maybe("new of a class below Blob", () => new (class extends Blob {})(["a"]), values);
maybe("new Blob without its prototype", () => Object.setPrototypeOf(new Blob(["a"]), null), values);
maybe("new Blob below File.prototype", () => Object.setPrototypeOf(new Blob(["a"]), File.prototype), values);
maybe("a proxy of new Blob", () => new Proxy(new Blob(["a"]), {}), values);
maybe("Blob made for File as new.target", () => Reflect.construct(Blob, [["a"]], File), values);
maybe("created below File.prototype", () => Object.create(File.prototype), values);
maybe("File.prototype", () => File.prototype, values);
maybe("File", () => File, values);
maybe("new File", () => new File(["a"], "a.txt"), values);
maybe("new of a class below File", () => new (class extends File {})(["a"], "a.txt"), values);
maybe("new File without its prototype", () => Object.setPrototypeOf(new File(["a"], "a.txt"), null), values);
maybe("new File below Blob.prototype", () => Object.setPrototypeOf(new File(["a"], "a.txt"), Blob.prototype), values);
maybe("a proxy of new File", () => new Proxy(new File(["a"], "a.txt"), {}), values);
maybe("File made for Blob as new.target", () => Reflect.construct(File, [["a"], "a.txt"], Blob), values);
maybe(`Bun.file("no-such-file.txt")`, () => (Bun.file("no-such-file.txt")), values);
maybe(`new File(["ab"], "a.txt").slice(1)`, () => (new File(["ab"], "a.txt").slice(1)), values);
maybe(`Bun.file("no-such-file.txt").slice(1)`, () => (Bun.file("no-such-file.txt").slice(1)), values);
maybe(`new Response("a")`, () => (new Response("a")), values);
maybe(`(() => { const form = new FormData(); form.append("a", new Blob(["a"]), "a.txt"); return form.get("a"); })()`, () => ((() => { const form = new FormData(); form.append("a", new Blob(["a"]), "a.txt"); return form.get("a"); })()), values);
maybe(`(() => { const form = new FormData(); form.append("a", new Blob(["a"])); return form.get("a"); })()`, () => ((() => { const form = new FormData(); form.append("a", new Blob(["a"])); return form.get("a"); })()), values);
for (const [name, value] of values) {
  let answers = "";
  for (const [, is, count] of tests) answers += show(attempt(() => is(value))) + show(attempt(() => count(value)));
  report(answers + " " + name);
}
const ordinary = Function.prototype[Symbol.hasInstance];
report("Blob: " + (Blob[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Blob, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Blob, value))) + show(attempt(() => Blob[Symbol.hasInstance](value)))).join(""));
report("File: " + (File[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(File, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(File, value))) + show(attempt(() => File[Symbol.hasInstance](value)))).join(""));
process.exit(0);
