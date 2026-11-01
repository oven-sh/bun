// `answer.body = text` in a handler that unknown code calls runs a setter of a literal two steps up the chain. Nothing in the program reads `.body`.
const answers = {
  get sent() {
    return this.res.sent;
  },
  has(name) {
    return this.res.names === name;
  },
  get status() {
    return this.res.code;
  },
  set status(code) {
    if (this.sent) return;
    this.hasOwnStatus = true;
    this.res.code = code;
  },
  set body(value) {
    const before = this.held;
    this.held = value;
    if (!this.hasOwnStatus) this.status = 200;
    if (!this.has("b")) this.length = value.length;
    if (before !== undefined) this.res.code = 0;
  },
  set length(n) {
    this.res.size = n;
  },
  get length() {
    return this.res.size;
  },
};
const ofApplication = Object.create(answers);
const suffix = process.argv.length > 9 ? "x" : "";
function handle(answer, text) {
  answer.body = text;
  return answer.status + answer.length;
}
globalThis["handle" + suffix] = handle;

function make(res) {
  const made = Object.create(ofApplication);
  made.res = res;
  return made;
}

let sum = 0;
for (let i = 0; i < 20000; i++) {
  const res = { sent: false, names: "a", code: 404, size: i & 1 };
  sum += globalThis["handle" + suffix](make(res), i & 1 ? "Hello" : "Hi");
}
console.log(sum);

const twice = make({ sent: false, names: "a", code: 404, size: 0 });
console.log(handle(twice, "one"), handle(twice, "three"), twice.held, twice.hasOwnStatus);
const sent = make({ sent: true, names: "b", code: 404, size: 7 });
console.log(handle(sent, "late"), sent.held, sent.hasOwnStatus);
const own = make({ sent: false, names: "a", code: 1, size: 1 });
Object.defineProperty(own, "body", { value: "mine", writable: true });
console.log(handle(own, "kept"), Object.getOwnPropertyDescriptor(own, "body").value, own.held);
try {
  handle(Object.create(ofApplication), "no res");
} catch (error) {
  console.log(error instanceof TypeError);
}
