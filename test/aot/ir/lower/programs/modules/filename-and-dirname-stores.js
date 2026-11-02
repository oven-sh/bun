// RUN: lower
// OPTIONS: builtin-modules

// An ES module stores to `__filename` and `__dirname`: each is a variable of the module that starts as `import.meta.path` and `import.meta.dir`, which the stores leave as they are.
export function readFilename() {
  return __filename;
}
export function storeDirname(value) {
  __dirname = value;
}

console.log(__filename === import.meta.path, __dirname === import.meta.dir, readFilename() === import.meta.path);
__filename = "stored";
console.log(__filename, readFilename(), import.meta.path === "stored");
storeDirname("stored by a function");
console.log(__dirname, import.meta.dir === __dirname);
__filename += "!";
console.log(readFilename(), typeof __filename);
for (let index = 0; index < 3; index++) {
  if (index === 1) continue;
  __filename = index;
}
console.log(__filename, readFilename());
[__filename, __dirname] = ["first", "second"];
console.log(__filename, __dirname);

// GENERATED: readFilename storeDirname
// CHECK-LABEL: function {{*}}name="readFilename"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="storeDirname"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: PutModuleVariable v0 variable=[[g_2]]
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
