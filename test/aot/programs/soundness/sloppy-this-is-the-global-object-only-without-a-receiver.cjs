function getX() { return this.x; }
function setX() { this.x = "text"; }
var a = { x: 1, get: getX };
var b = { x: "s", set: setX };
function Client() { this.fetch = function () { return 1; }; }
exports.run = function () {
  b.set();
  var c = new Client();
  return [a.get(), b.x, typeof fetch, c.fetch()].join(" ");
};

function mark(name) { this[name] = (this[name] || 0) + 1; return this === globalThis; }
function markFixed() { this.s003Fixed = (this.s003Fixed || 0) + 1; return this === globalThis; }
exports.guard = function () {
  var answers = [];
  answers.push(markFixed());
  answers.push(markFixed.call(undefined));
  answers.push(markFixed.apply(null, []));
  answers.push(Reflect.apply(markFixed, undefined, []));
  answers.push(markFixed.bind(undefined)());
  [1].forEach(function () { answers.push(markFixed.call(this)); });
  [1].map(markFixed).forEach(function (answer) { answers.push(answer); });
  answers.push(mark("s003Named"));
  var holder = { markFixed: markFixed };
  answers.push(holder.markFixed());
  var loose = holder.markFixed;
  answers.push(loose());
  answers.push((0, holder.markFixed)());
  return answers.join(",") + " " + globalThis.s003Fixed + " " + globalThis.s003Named + " " + holder.s003Fixed;
};
console.log(exports.run());
console.log(exports.guard());
