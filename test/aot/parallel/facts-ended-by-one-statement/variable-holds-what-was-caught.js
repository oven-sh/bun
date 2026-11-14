// A variable that holds a function takes whatever a handler caught.
let setting = () => 4;
let seen = 0;
function read() {
  seen++;
  return typeof setting === "function" ? setting() : setting;
}
function rounds(n) {
  let text = "";
  for (let i = 0; i < n; i++) text += String(read()) + typeof setting + ";";
  return text;
}
function keepWhatIsThrown(thrown) {
  try {
    throw thrown;
  } catch (error) {
    setting = error;
  }
}
console.log(rounds(3), seen);
for (const thrown of ["text", 1.5, new RangeError("range"), undefined, () => 9]) {
  keepWhatIsThrown(thrown);
  console.log(rounds(2), seen);
}
