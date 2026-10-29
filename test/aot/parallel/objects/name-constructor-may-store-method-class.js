// A constructor stores `_read` only where its options name one, and the classes have a method of that name. The name is read and compared, read and called, on objects
// with the slot empty and filled, while the methods of the classes are replaced, hidden, deleted and turned into accessors, and the objects change their prototype.
const lines = [];

function Source(options) {
  this.count = 0;
  this.label = "source";
  if (options && typeof options.read === "function") this._read = options.read;
}
const baseRead = function baseRead(n) {
  this.count += n;
  return "base";
};
Source.prototype._read = baseRead;

function Request(options) {
  Source.call(this, options);
  this.label = "request";
}
Object.setPrototypeOf(Request.prototype, Source.prototype);
Object.setPrototypeOf(Request, Source);
const requestRead = function requestRead(n) {
  this.count += 2 * n;
  return "request";
};
Request.prototype._read = requestRead;

class Plain {
  constructor(options) {
    this.total = 0;
    if (options !== undefined && options.step !== undefined) this.step = options.step;
  }
  step(n) {
    this.total += n;
    return "class";
  }
}
const plainStep = Plain.prototype.step;

// What stands behind the comparison reads and stores more fields of the same object.
function isUntouched(request) {
  if (request._read !== requestRead) return "other:" + request.label;
  request.count += 1;
  request.label = request.label + "!";
  return "same:" + request.count + ":" + request.label.length;
}

function readAndCall(request, n) {
  const before = request.count;
  const answer = request._read(n);
  return answer + ":" + (request.count - before);
}

function stepOf(plain) {
  const step = plain.step;
  plain.total += 1;
  return (step === plainStep ? "same" : typeof step) + ":" + plain.total;
}

function round(title, objects) {
  const row = [];
  for (const object of objects) {
    if (object instanceof Plain) row.push(stepOf(object), object.step === undefined ? "none" : typeof object.step === "function" ? object.step(3) : String(object.step));
    else {
      let called;
      try {
        called = readAndCall(object, 5);
      } catch (error) {
        called = error.constructor.name;
      }
      row.push(isUntouched(object), called);
    }
  }
  lines.push(title + " " + row.join(" "));
}

const own = function ownRead(n) {
  this.count -= n;
  return "own";
};
function make() {
  return [
    new Request(),
    new Request({}),
    new Request({ read: own }),
    new Request({ read: requestRead }),
    new Source(),
    new Source({ read: own }),
    new Source({ read: baseRead }),
    new Plain(),
    new Plain({ step: 7 }),
    new Plain({ step: plainStep }),
    new Plain({ step: null }),
  ];
}

for (let i = 0; i < 40; i++) round("warm", make());
lines.length = 1;

let objects = make();
round("made", objects);

objects[0]._read = own;
objects[7].step = () => "arrow";
round("stored late", objects);

delete objects[0]._read;
delete objects[2]._read;
delete objects[7].step;
delete objects[8].step;
round("deleted", objects);

Object.defineProperty(objects[1], "_read", { get: () => own, configurable: true });
Object.defineProperty(objects[9], "step", { value: "fixed", writable: false, configurable: true });
round("defined", objects);

objects[3].extra = 1;
objects[4].other = 2;
objects[10].more = 3;
round("with more properties", objects);

objects = make();
Object.setPrototypeOf(objects[0], Source.prototype);
Object.setPrototypeOf(objects[1], { _read: own, __proto__: Request.prototype });
Object.setPrototypeOf(objects[7], null);
lines.push("no prototype " + String(objects[7].step));
objects[7] = new Plain();
round("other prototypes", objects);

objects = make();
Request.prototype._read = function replaced(n) {
  this.count += 3 * n;
  return "replaced";
};
round("replaced", objects);
round("replaced, new objects", make());

delete Request.prototype._read;
round("deleted above", make());

Object.defineProperty(Request.prototype, "_read", {
  get() {
    return this.label === "request" ? requestRead : own;
  },
  set(value) {
    Object.defineProperty(this, "_read", { value, writable: true, enumerable: true, configurable: true });
  },
  configurable: true,
});
round("accessor above", make());

Object.defineProperty(Request.prototype, "_read", { value: requestRead, writable: true, configurable: true });
round("put back", make());

Plain.prototype.step = 12;
round("a number above", make());
delete Plain.prototype.step;
round("nothing above", make());

console.log(lines.join("\n"));
