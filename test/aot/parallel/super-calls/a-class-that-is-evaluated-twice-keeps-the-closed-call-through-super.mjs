const make = Above => class extends Above { tell(word) { return "<" + super.tell(word) + ">"; } };
class Plain { tell(word) { return "plain " + word; } }
class Loud { tell(word) { return word.toUpperCase(); } }
const kinds = JSON.parse("[0,1,0,1]").map(kind => make(kind ? Loud : Plain));
console.log(kinds.map(kind => new kind().tell("word")).join(" "));
console.log(new (make(make(Plain)))().tell("twice"));
