// The function that process.setUncaughtExceptionCaptureCallback is given looks at its `this`.
const lines = [];
process.setUncaughtExceptionCaptureCallback(function (error) {
  lines.push(this === undefined ? "undefined" : typeof this);
  lines.push(typeof this === "function" ? "a function" : "no function");
  try { lines.push(String(this.name)); } catch (e) { lines.push(e.constructor.name); }
  lines.push(arguments.length + " " + typeof arguments[1]);
});
await new Promise(resolve => { setTimeout(() => { setTimeout(resolve, 5); throw new TypeError("thrown"); }, 1); });
process.setUncaughtExceptionCaptureCallback(null);
console.log(lines.join("\n"));
