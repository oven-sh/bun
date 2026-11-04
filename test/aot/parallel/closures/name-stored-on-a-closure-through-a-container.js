// A name is read off a closure that seems to stay as it was made, and is stored on it through a list that holds it.
// Under: --aot-testing=CheckProofsAtRunTime: LinkedFunction::closuresStayAsMade
function subject() {
  return 1;
}
const held = [subject];
function read() {
  return String(subject.cache) + String("cache" in subject) + String(subject());
}
function deed() {
  held[held.length - 1].cache = "stored";
}
console.log(read());
let last = "";
for (let i = 0; i < 300; i++) last = read();
console.log(last);
deed();
console.log(read());
