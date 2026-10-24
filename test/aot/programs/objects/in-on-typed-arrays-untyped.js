// `"name" in view` where view is a typed array, as the package etag asks a Buffer for "ctime": the answers, and that the run time is asked once and not every time.
// Only the jsc shell can count. Elsewhere the program checks the answers alone.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
function isStats(object) {
  return object && typeof object === "object" && "ctime" in object && "mtime" in object && "ino" in object && "size" in object;
}
const bytes = new Uint8Array([1, 2, 3]);
const seen = new Set();
let before = count("operationAOTInByValAndCache");
for (let i = 0; i < 2000; i++)
  seen.add([isStats(bytes), "byteLength" in bytes, "subarray" in bytes, "toString" in bytes, "nothing of the kind" in bytes].join());
let calls = count("operationAOTInByValAndCache") - before;
console.log([...seen].join(" | "), calls <= 40 ? "and the run time was asked at most 40 times" : "and the run time was asked " + calls + " times");
console.log("length" in bytes, "name" in bytes, "prototype" in bytes, "__proto__" in bytes);

// Names that are numbers as they would be printed are elements or nothing, whatever the prototypes have.
class Tagged extends Uint8Array {}
Tagged.prototype.ctime = "of the class";
Tagged.prototype["1.5"] = "never seen";
Tagged.prototype["-0"] = "never seen";
Tagged.prototype["7"] = "never seen";
Tagged.prototype.Infinity = "never seen";
Tagged.prototype.NaN = "never seen";
Tagged.prototype["1e+21"] = "never seen";
Tagged.prototype["01"] = "an ordinary name";
Tagged.prototype["1.50"] = "an ordinary name";
const names = ["0", "2", "3", "7", "-0", "-1", "1.5", "Infinity", "-Infinity", "NaN", "1e+21", "01", "1.50", "+1", "", "ctime", "mtime", "constructor", "buffer"];
const views = [bytes, new Tagged(3), new Float64Array(1), new Int8Array(0), new BigInt64Array(2), new Uint8Array(new ArrayBuffer(8), 2, 4)];
for (let round = 0; round < 3; round++) {
  for (const view of views)
    console.log(view.constructor.name, names.map((name) => name in view ? 1 : 0).join(""));
}

// The answer follows what the view and its prototypes are given and lose.
const own = new Uint8Array(2);
const answers = [];
for (let i = 0; i < 8; i++) {
  answers.push("ctime" in own ? 1 : 0);
  if (i === 2)
    own.ctime = 1;
  if (i === 4)
    delete own.ctime;
}
console.log(answers.join(""));
const heir = new Tagged(1);
const inherited = [];
for (let i = 0; i < 8; i++) {
  inherited.push(("comes later" in heir ? 1 : 0) + ("ctime" in heir ? 2 : 0));
  if (i === 2)
    Tagged.prototype["comes later"] = true;
  if (i === 4)
    delete Tagged.prototype["comes later"];
  if (i === 5)
    delete Tagged.prototype.ctime;
}
console.log(inherited.join(""));
const moved = new Uint8Array(1);
const after = [];
for (let i = 0; i < 6; i++) {
  after.push("ctime" in moved ? 1 : 0);
  if (i === 2)
    Object.setPrototypeOf(moved, { ctime: 1 });
}
console.log(after.join(""));
