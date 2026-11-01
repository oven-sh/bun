require("node:vm").runInThisContext(`
  process.release.flag = 1;
  process.release.helper = function () { return 7; };
  process.versions.flag = 1;
  process.versions.helper = function () { return 7; };
  process.release[5] = 5;
  process.versions[Symbol.for("fromEval")] = 3;
  process.release.sourceUrl = 1;
  delete process.release.headersUrl;
  Object.defineProperty(process.release, "computed", { get() { return 5; } });
  Object.setPrototypeOf(process.release, { inherited: 1 });
  globalThis.savedRelease = process.release;
  globalThis.storeLater = (name, value) => { process.release[name] = value; };
`);
const say = (label, use) => {
  let seen;
  try {
    seen = String(use());
  } catch (error) {
    seen = "throws " + error.name;
  }
  console.log(label, "|", seen);
};
say("release, read", () => process.release.flag);
say("release, plus one", () => process.release.flag + 1);
say("release, a condition", () => (process.release.flag ? "yes" : "no"));
say("release, nullish default", () => process.release.flag ?? "absent");
say("release, a template", () => `<${process.release.flag}>`);
say("release, destructured", () => (({ flag }) => flag * 3)(process.release));
say("release, greater", () => process.release.flag > 0);
say("release, in", () => "flag" in process.release);
say("release, a call", () => process.release.helper());
say("release, an optional call", () => process.release.helper?.() ?? "none");
say("release, missing", () => process.release.neverStored + 1);
say("versions, read", () => process.versions.flag);
say("versions, plus one", () => process.versions.flag + 1);
say("versions, a condition", () => (process.versions.flag ? "yes" : "no"));
say("versions, nullish default", () => process.versions.flag ?? "absent");
say("versions, a call", () => process.versions.helper());
say("versions, an optional call", () => process.versions.helper?.() ?? "none");
say("versions, missing", () => process.versions.neverStored + 1);
say("through the global object", () => globalThis.process.release.flag + 1);
say("an index", () => process.release[5] + 1);
say("a symbol", () => process.versions[Symbol.for("fromEval")] + 1);
say("overwritten", () => process.release.sourceUrl + 1);
say("deleted", () => process.release.headersUrl.length);
say("untouched", () => process.release.name + " " + typeof process.versions.bun);
say("a getter", () => process.release.computed + 1);
say("inherited", () => process.release.inherited + 1);
say("copied by spread", () => (({ ...all }) => all.flag + 1)(process.release));
say("copied by Object.assign", () => Object.assign({}, process.release).flag + 1);
say("keys", () => Object.keys(process.release).join());
say("stored through a saved reference", () => ((savedRelease.viaSaved = 2), process.release.viaSaved + 1));
say("stored later by an evaluated function", () => (storeLater("late", 4), process.release.late + 1));
