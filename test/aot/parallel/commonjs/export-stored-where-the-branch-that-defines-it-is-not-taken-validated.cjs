// Flags: --aot-validate
// A branch that is not taken defines the export read-only. The store creates an ordinary property, and what is stored is read again.
const flag = process.argv.length > 100;
while (flag) exports.inLoopThatNeverRuns = 1;
try {
} finally {
}
switch (flag ? "a" : "b") {
}
skipped: {
}
if (flag) Object.defineProperty(exports, "definedOrStored", { value: "defined" });
else exports.definedOrStored = "stored";
if (flag) exports.storedOrDefined = "stored";
else Object.defineProperty(exports, "storedOrDefined", { value: "defined" });
console.log(Object.keys(exports).join(), JSON.stringify(exports), JSON.stringify(Object.getOwnPropertyDescriptors(exports)));
for (const key in exports) console.log(key);
exports.definedOrStored = "again";
exports.storedOrDefined = "again";
console.log(exports.definedOrStored, exports.storedOrDefined, delete exports.definedOrStored, delete exports.storedOrDefined, Object.keys(exports).join());
console.log(Object.entries(exports).join(), { ...exports }, Object.assign({}, exports), exports.propertyIsEnumerable("definedOrStored"), exports.propertyIsEnumerable("storedOrDefined"));
