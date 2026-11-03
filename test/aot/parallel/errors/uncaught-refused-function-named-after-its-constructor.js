// Nothing catches the error of a call of an object. What is printed names the object after the function under its `constructor`.
function Named() {}
function callIt(f) {
  return f();
}
process.on("uncaughtException", error => console.log(error.message));
callIt({ constructor: Named });
