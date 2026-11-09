// `["constructor"]() {}` is a method of the prototype object. A class below has a `constructor` of its own, which hides it.
const word = "constructor";
class Above { ["constructor"]() { return "method"; } plain() { return 1; } }
class Below extends Above { plain() { return 2; } }
class Other { [word]() { return "by a constant"; } }
class Under extends Other { }
function ask(list) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let said = "";
  for (let i = 0; i < list.length; i++) said = list[i].constructor() + work;
  return said;
}
function askOther(list) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let said = "";
  for (let i = 0; i < list.length; i++) said = list[i].constructor() + work;
  return said;
}
const first = [], second = [];
for (let i = 1; i < 400; i++) {
  first.push(i % 3 ? new Above() : new Below());
  second.push(i % 3 ? new Other() : new Under());
}
try { console.log(ask(first)); } catch (e) { console.log(e.name); }
try { console.log(askOther(second)); } catch (e) { console.log(e.name); }
console.log(new Below().constructor === Below, new Under().constructor === Under);
