// Sloppy code: a store to a character of a String object and a delete of one are refused without an error, and a function that is called on a string gets a String object as its receiver.
function line(name, body) {
  try {
    console.log(name, JSON.stringify(body()));
  } catch (error) {
    console.log(name, "threw", error.constructor.name);
  }
}

function readOfReceiver(index) {
  var character = this[index];
  return [typeof this, typeof character, character === undefined ? "none" : character.length];
}
function receiver() {
  return this;
}

var boxed = receiver.call("abc");
var second = boxed[1];
console.log(typeof boxed, second === undefined, typeof second, second + "!", second.length);

line("receiver", function () { return [readOfReceiver.call("abc", 1), readOfReceiver.call("abc", 3), readOfReceiver.call(7, 0), readOfReceiver.apply("xy", [0])]; });
line("the usual helper", function () {
  function each(callback) {
    var O = Object(this);
    var seen = [];
    for (var k = 0; k < O.length >>> 0; k++) if (k in O) seen.push(callback(O[k], k));
    return seen;
  }
  return [each.call("ab", function (value) { return typeof value + value.length; }), each.call([1, "x"], function (value) { return typeof value; })];
});
line("store over a character", function () { var text = new String("abc"); text[1] = "z"; var found = text[1]; return [found, typeof found, found.length]; });
line("store of a number over a character", function () { var text = new String("abc"); text[0] = 5; var found = text[0]; return [found, typeof found, found.length]; });
line("store past the end", function () { var text = new String("abc"); text[3] = 5; return [text[3], typeof text[3], typeof text[2], Object.keys(text)]; });
line("store under every index", function () { var text = new String("ab"); for (var index = 0; index < 4; index++) text[index] = index; return [0, 1, 2, 3].map(function (index) { return typeof text[index]; }); });
line("store to the length", function () { var text = new String("abc"); text.length = 1; return [text.length, text[2]]; });
line("delete of a character", function () { var text = new String("abc"); return [delete text[1], typeof text[1], text[1].length, delete text[3], delete text.length]; });
line("store through an heir", function () { var heir = Object.create(new String("abc")); heir[1] = 5; heir[3] = 5; return [typeof heir[1], heir[1].length, heir[3], Object.keys(heir)]; });
line("store on a string", function () { var text = "abc"; text[1] = "z"; text[5] = "z"; return [text[1], typeof text[5]]; });
line("with", function () { var found; with (new String("ab")) found = length; return found; });
