const util = require("util");
const { inherits: importedInherits } = require("node:util");

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function attempt(label, run) {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " -> threw " + error.constructor.name);
  }
}

function packageInherits(ctor, superCtor) {
  if (superCtor) {
    ctor.super_ = superCtor;
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: { value: ctor, enumerable: false, writable: true, configurable: true },
    });
  }
}

function oldPackageInherits(ctor, superCtor) {
  if (superCtor) {
    ctor.super_ = superCtor;
    var TempCtor = function () {};
    TempCtor.prototype = superCtor.prototype;
    ctor.prototype = new TempCtor();
    ctor.prototype.constructor = ctor;
  }
}

function protoInherits(ctor, superCtor) {
  ctor.prototype.__proto__ = superCtor.prototype;
}

function instanceInherits(ctor, superCtor) {
  ctor.prototype = new superCtor("from the prototype");
  ctor.prototype.constructor = ctor;
}

function Stream(source) {
  this.source = source;
  this.chunks = 0;
}
Stream.prototype.push = function () {
  this.chunks++;
  return this;
};
Stream.prototype.report = function () {
  return this.source + " pushed " + this.chunks;
};

function Other(source) {
  this.source = "other " + source;
  this.chunks = 100;
}
Other.prototype.report = function () {
  return "other report of " + this.source;
};

function reportOf(stream) {
  return stream.report();
}

function pushInto(stream) {
  return stream.push();
}

const ways = [
  ["util.inherits", (child, parent) => util.inherits(child, parent)],
  ["an imported inherits", (child, parent) => importedInherits(child, parent)],
  ["util['inherits']", (child, parent) => util["inh" + "erits"](child, parent)],
  ["the package's inherits", packageInherits],
  ["the package's old inherits", oldPackageInherits],
  ["__proto__ of the prototype", protoInherits],
  ["an instance of the parent as the prototype", instanceInherits],
];

for (const [label, inherit] of ways) {
  function FileStream(source) {
    Stream.call(this, source);
    this.path = "/" + source;
  }
  const makeStream = source => new FileStream(source);
  FileStream.prototype.early = function () {
    return "defined before the link";
  };
  attempt(label + ": link", () => inherit(FileStream, Stream));
  FileStream.prototype.late = function () {
    return "defined after the link";
  };

  let length = 0;
  for (let i = 0; i < 2000; i++) length += reportOf(pushInto(makeStream("f" + (i % 3)))).length;
  console.log(label + ": 2000 honest streams", length);

  const stream = makeStream("file");
  attempt(label + ": a stream", () => stream);
  attempt(label + ": report()", () => reportOf(pushInto(stream)));
  attempt(label + ": early()", () => stream.early());
  attempt(label + ": late()", () => stream.late());
  attempt(label + ": super_", () => FileStream.super_);
  attempt(label + ": constructor", () => stream.constructor === FileStream);
  attempt(label + ": for-in", () => { const names = []; for (const name in stream) names.push(name); return names; });
  attempt(label + ": instanceof", () => [stream instanceof FileStream, stream instanceof Stream, stream instanceof Other]);

  attempt(label + ": link again, to another parent", () => inherit(FileStream, Other));
  attempt(label + ": the old stream reports", () => reportOf(stream));
  attempt(label + ": the old stream is pushed into", () => pushInto(stream).chunks);
  attempt(label + ": a new stream reports", () => reportOf(makeStream("new")));
  attempt(label + ": a new stream is pushed into", () => pushInto(makeStream("new")).chunks);
  attempt(label + ": instanceof now", () => [stream instanceof FileStream, stream instanceof Stream, stream instanceof Other]);
  attempt(label + ": super_ now", () => FileStream.super_);
}

for (const [label, child, parent] of [
  ["a parent that is undefined", function () {}, undefined],
  ["a parent that is null", function () {}, null],
  ["a parent without a prototype", function () {}, () => {}],
  ["a child that is undefined", undefined, Stream],
  ["a parent that is a class", function () {}, class Modern { report() { return "modern"; } }],
  ["a child that is a class", class Modern {}, Stream],
]) {
  attempt("util.inherits with " + label, () => {
    util.inherits(child, parent);
    return reportOf(Object.assign(Object.create(child.prototype), { source: "made", chunks: 0 }));
  });
}
