// A function makes an object, stores it in a member of a local object and suspends. Behind the suspension it reads another member. Asked while it is suspended: is the first object still there?
let last;
let sink = 0;
class Holder {
  constructor(read, kept) {
    this.read = read;
    this.kept = kept;
  }
}
function make(n) {
  const made = { n };
  last = new WeakRef(made);
  return made;
}
async function pause(label) {
  for (let round = 0; round < 4; round++) {
    await new Promise(resolve => setTimeout(resolve, 1));
    Bun.gc(true);
  }
  console.log(label + ":", last.deref() !== undefined ? "kept" : "collected");
  return 1;
}
async function walk(walker, label) {
  await walker.next();
  await pause(label);
  return (await walker.next()).value;
}

async function readsWhatItMade(n) {
  const x = n >= 0 ? make(n) : null;
  sink += x.n;
  await pause("a local read behind the await");
  return x.n;
}
async function instance(n) {
  const holder = new Holder(n, make(n));
  await pause("a member of an instance");
  return holder.read;
}
async function literal(n) {
  const holder = { read: n, kept: make(n) };
  await pause("a member of a literal");
  return holder.read;
}
async function list(n) {
  const holder = [n, make(n)];
  await pause("an element of a list");
  return holder[0];
}
async function literalInLiteral(n) {
  const holder = { read: n, inner: { kept: make(n) } };
  await pause("a member of a member of a literal");
  return holder.read;
}
async function instanceInList(n) {
  const holder = [n, new Holder(n, make(n))];
  await pause("a member of an instance in a list");
  return holder[0];
}
async function storedLater(n) {
  const holder = { read: n, kept: null };
  holder.kept = make(n);
  await pause("a member stored behind the literal");
  return holder.read;
}
async function readOnOneArm(n) {
  const holder = new Holder(n, make(n));
  await pause("a member of an instance read on one arm");
  return n >= 0 ? holder.read : 0;
}
async function readInFrontToo(n) {
  const holder = new Holder(n, make(n));
  sink += holder.read;
  await Promise.all([pause("a member of an instance read in front too")]);
  return holder.read;
}
async function readInAFinallyBlock(n) {
  const holder = [n, make(n)];
  try {
    throw 1;
  } catch {
    await pause("an element of a list read in a finally block");
  }
  try {
    return 1;
  } finally {
    sink += holder[0];
  }
}
async function namedTwice(n) {
  const made = make(n);
  const holder = new Holder(n, made);
  sink += made.n;
  await pause("a member that a local names in front too");
  return holder.read;
}
async function twoHolders(n) {
  const made = make(n);
  const first = new Holder(n, made);
  const second = { read: n, kept: made };
  await pause("a member of two objects");
  return first.read + second.read;
}
function* yields(n) {
  const holder = new Holder(n, make(n));
  yield 1;
  return holder.read;
}
async function* yieldsAndAwaits(n) {
  const holder = new Holder(n, make(n));
  yield 1;
  return holder.read;
}
async function* yieldsAList(n) {
  const holder = [n, make(n)];
  yield 1;
  return holder[0];
}

for (let n = 0; n < 1; n++) {
  await readsWhatItMade(n);
  await instance(n);
  await literal(n);
  await list(n);
  await literalInLiteral(n);
  await instanceInList(n);
  await storedLater(n);
  await readOnOneArm(n);
  await readInFrontToo(n);
  await readInAFinallyBlock(n);
  await namedTwice(n);
  await twoHolders(n);
  await walk(yields(n), "a member of an instance in a generator");
  await walk(yieldsAndAwaits(n), "a member of an instance in an async generator");
  await walk(yieldsAList(n), "an element of a list in an async generator");
}
console.log(typeof sink);
