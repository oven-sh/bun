// `target[key] = source[key]` in loops over the names of the source: each name of the target holds what the source held under it, and nothing else.
const lines = [];
function Writer() {}
Writer.prototype.write = function (text) {
  return "write " + text;
};
Writer.prototype.end = function () {
  return "end";
};
Writer.prototype.limit = 16;
Writer.prototype.label = "writer";
function Reader() {}
Reader.prototype.read = function () {
  return "read";
};
Reader.prototype.end = function () {
  return "the reader's own end";
};
const names = Object.keys(Writer.prototype);
for (let i = 0; i < names.length; i++) {
  const name = names[i];
  if (!Reader.prototype[name]) Reader.prototype[name] = Writer.prototype[name];
}
const both = new Reader();
lines.push(both.read(), both.write("a"), both.end(), both.limit + 1, both.label.length);

class Base {
  inherited() {
    return "inherited";
  }
}
class Settings extends Base {
  constructor() {
    super();
    this.depth = 3;
    this.name = "settings";
    this.run = () => "run";
  }
}
const byForIn = {};
const settings = new Settings();
for (const key in settings) byForIn[key] = settings[key];
lines.push(byForIn.depth * 2, byForIn.name.toUpperCase(), byForIn.run(), typeof byForIn.inherited);

const byOwnNames = {};
for (const key of Object.getOwnPropertyNames(Base.prototype)) byOwnNames[key] = Base.prototype[key];
lines.push(byOwnNames.inherited(), byOwnNames.constructor === Base);

const mark = Symbol("mark");
const marked = { [mark]: () => "marked", plain: () => "plain" };
const byOwnKeys = {};
for (const key of Reflect.ownKeys(marked)) byOwnKeys[key] = marked[key];
lines.push(byOwnKeys[mark](), byOwnKeys.plain());

// What is done to the source afterwards stays with the source.
Writer.prototype.write = function () {
  return "another write";
};
settings.depth = "deep";
lines.push(both.write("b"), byForIn.depth + 1);
console.log(lines.join("\n"));
