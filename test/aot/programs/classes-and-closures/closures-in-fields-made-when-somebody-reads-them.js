// One object a round whose fields hold arrow functions. A round calls one or two of them. object-census.test.ts counts how many function objects the run makes.
class Reply {
  #raw;
  #status;
  env = {};
  #vars;
  finalized = false;
  constructor(raw, options) {
    this.#raw = raw;
    if (options) this.env = options.env;
  }
  renderReply = (...args) => this.#raw + args.length;
  statusReply = code => {
    this.#status = code;
  };
  setReply = (key, value) => {
    this.#vars ??= new Map();
    this.#vars.set(key, value);
  };
  getReply = key => (this.#vars ? this.#vars.get(key) : undefined);
  textReply = (text, code) => this.#raw + ":" + text + ":" + (code ?? this.#status ?? 200);
  jsonReply = object => JSON.stringify(object) + this.finalized;
  notFoundReply = () => "404 " + this.#raw;
}
function handle(i, keep) {
  const reply = new Reply("r" + i, i % 3 ? undefined : { env: { i } });
  if (i % 5 === 0) reply.statusReply(201);
  if (keep) keep.push(reply.jsonReply, reply);
  return reply.textReply("x");
}

// The members of a literal, which another function gives other functions, and of which a copy is made now and then.
let calls = 0;
function tools() {
  const made = {
    firstTool: () => ++calls,
    secondTool: () => "two" + calls,
    thirdTool: source => source + calls,
    fourthTool: () => calls % 2 === 0,
  };
  made.ownTool = () => made.firstTool() + 1;
  return made;
}
function otherTools() {
  const made = {
    firstTool: () => 7,
    secondTool: () => "other",
    thirdTool: source => source,
    fourthTool: () => true,
  };
  made.ownTool = () => 1;
  return made;
}
function use(made, n) {
  return n % 2 ? made.firstTool() : made.ownTool();
}

let length = 0;
let sum = 0;
for (let i = 0; i < 3000; i++) {
  length += handle(i, null).length;
  sum += use(i % 100 === 0 ? otherTools() : i % 100 === 1 ? { ...tools(), fourthTool: () => false } : tools(), i);
}
const kept = [];
console.log(length, sum, handle(1, kept), handle(5, kept));
console.log(kept[0]({ a: 1 }), kept[2] === kept[3].jsonReply, kept[1].jsonReply !== kept[3].jsonReply, Object.keys(kept[1]).join());
console.log(kept[1].notFoundReply(), (kept[1].setReply("k", 7), kept[1].getReply("k")), kept[3].renderReply(1, 2, 3), tools().secondTool(), tools().thirdTool("t"), tools().fourthTool());
