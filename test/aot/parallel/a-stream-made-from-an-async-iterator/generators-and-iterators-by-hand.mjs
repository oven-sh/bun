// Readable.from() over an async generator, over async iterators written by hand, and over generators whose `next` is the program's: what arrives, in which order, and who is asked.
import { Readable } from "node:stream";

const log = [];
const say = (...words) => log.push(words.join(" "));
const show = value => (typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));

async function drain(name, iterable, options) {
  say("==", name);
  let stream;
  try {
    stream = Readable.from(iterable, options);
  } catch (error) {
    say("  refused", error.code);
    return;
  }
  await new Promise(resolve => {
    stream.on("data", chunk => say("  data", show(chunk)));
    stream.on("end", () => say("  end"));
    stream.on("error", error => say("  error", error.code ?? error.message));
    stream.on("close", () => (say("  close"), resolve()));
  });
}

async function* counts(to) {
  for (let i = 1; i <= to; i++) yield i;
}
async function* late(to) {
  for (let i = 1; i <= to; i++) {
    await new Promise(resolve => setImmediate(resolve));
    yield "late" + i;
  }
}
async function* nested() {
  for await (const n of late(2)) yield n + "!";
  yield* counts(2);
}
async function* throwsAt(n) {
  for (let i = 1; ; i++) {
    if (i === n) throw new Error("thrown at " + n);
    yield i;
  }
}
async function* yields(...values) {
  try {
    for (const value of values) yield value;
  } finally {
    say("  the generator is left");
  }
}

await drain("an async generator", counts(3));
await drain("one whose pieces arrive later", late(3));
await drain("one that loops over others", nested());
await drain("one that yields nothing", counts(0));
await drain("one that throws at once", throwsAt(1));
await drain("one that throws later", throwsAt(3));
await drain("one that yields null", yields("a", null, "b"));
await drain("one that yields undefined, 0, an empty text, false", yields(undefined, 0, "", false));
await drain("one that yields promises", yields(Promise.resolve("kept"), "plain"));
await drain("one that yields objects", yields({ a: 1 }, [2], { then: undefined }));
await drain("with a high water mark of three", counts(7), { highWaterMark: 3 });
await drain("bytes", yields(Buffer.from("ab"), "cd"), { objectMode: false });

function byHand(steps, more = {}) {
  let at = 0;
  return {
    [Symbol.asyncIterator]() {
      say("  asked for the iterator");
      return {
        next(...sent) {
          say("  next", sent.length);
          return steps[at++]();
        },
        ...more,
      };
    },
  };
}
const step = (value, done = false) => ({ value, done });
await drain("an iterator by hand that answers promises", byHand([async () => step(1), async () => step(2), async () => step(undefined, true)]));
await drain("one that answers the results themselves", byHand([() => step("bare"), () => step(undefined, true)]));
await drain("one that answers what can be awaited", byHand([() => ({ then(resolve) { say("  then"); resolve(step("thenable")); } }), () => step(0, true)]));
await drain("one whose results are asked through accessors", byHand([
  () => ({ get value() { say("  value is read"); return "v"; }, get done() { say("  done is read"); return false; } }),
  () => ({ get value() { say("  value is read"); return "last"; }, get done() { say("  done is read"); return 1; } }),
]));
await drain("one that answers no object", byHand([() => 7]));
await drain("one that answers undefined", byHand([() => undefined]));
await drain("one that rejects", byHand([() => Promise.reject(new Error("rejected"))]));
await drain("one that throws", byHand([() => { throw new Error("thrown by next"); }]));
await drain("one with return and throw", byHand([() => step(1), () => Promise.reject(new Error("rejected"))], {
  return() { say("  return"); return step(undefined, true); },
  throw(error) { say("  throw", error.message); return step(undefined, true); },
}));
await drain("one without next", { [Symbol.asyncIterator]: () => ({}) });

const own = counts(3);
own.next = function (...sent) {
  say("  its own next", sent.length);
  return Object.getPrototypeOf(this).next.call(this);
};
await drain("a generator with a next of its own", own);

const family = Object.getPrototypeOf(counts);
const shared = Object.getPrototypeOf(family.prototype);
const original = shared.next;
counts.prototype.next = function () {
  say("  the next of this function's generators");
  return original.call(this);
};
await drain("a next on the prototype of the function", counts(2));
delete counts.prototype.next;

const other = counts(2);
Object.setPrototypeOf(other, { next: () => (say("  another prototype"), step(undefined, true)), [Symbol.asyncIterator]() { return this; } });
await drain("a generator with another prototype", other);

const borrowed = { inner: counts(2), next() { say("  borrowed"); return original.call(this.inner); }, [Symbol.asyncIterator]() { return this; } };
await drain("an object that borrows a generator", borrowed);

function* plain() {
  yield "sync1";
  yield Promise.resolve("sync2");
  yield "sync3";
}
await drain("a generator that is not async", plain());
await drain("a list", ["x", "y"]);
await drain("a text", "text");
await drain("no iterable", 5);

console.log(log.join("\n"));
