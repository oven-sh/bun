// An element of `arguments` that is written into a tagged template is read. An element that is the tag is called with `arguments` as `this`, and changes it.
function tag(texts) { return texts.join("|") + ":" + Array.prototype.slice.call(arguments, 1).join(); }
function written(a, b) { return tag`x${arguments[0]}y${arguments[1]}z${arguments.length}`; }
function changes() { this[1] = "changed"; this.length = 3; this[2] = "added"; return "called"; }
function asTheTag(f, b) { var said = arguments[0]`t`; return [said, b, arguments[1], arguments.length, arguments[2]].join(); }
for (var i = 0; i < 3; i++) console.log(written(i, "b"), written(i), asTheTag(changes, "b"));
