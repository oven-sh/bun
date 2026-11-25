// Flags: --format=cjs --define=KEPT=helper.value --define=AGAIN=self.call --define=COUNT=arguments.length --define=FIRST=arguments.valueOf --define=LEVEL=local.level --define=LIST=local.list --define=__dirname=local.folder --define=HERE=__filename.length
// Reference: bun build --compile
// The name that is written has the value at the end of the path, and is a use of the name at its start.
function kept() { function helper() {} const set = () => { KEPT = 5; }; const get = () => KEPT; set(); return get(); }
function counts(a) { a = 9; const first = FIRST()[0]; COUNT = 0; return [first, arguments.length]; }
function reads() {
  const local = { level: 0, list: [], folder: "folder" };
  return [typeof LEVEL, LEVEL ? "truthy" : "falsy", LIST.push(1), __dirname, typeof HERE];
}
console.log(kept(), counts(1, 2, 3).join(), reads().join());
(function self(n, extra) { if (n > 0) return console.log(extra); AGAIN(null, 1, "again"); })(0);
