// A TypeError quotes the read, the store or the test that failed on one line, however many lines it is written over, and of several reads of one name the one that failed.
function tell(label, run) {
  try {
    run();
    console.log(label + ": nothing thrown");
  } catch (error) {
    console.log(label + ": " + error.constructor.name + ": " + error.message + " | " + /:(\d+:\d+)\)?$/.exec(error.stack.split("\n")[1])[1]);
  }
}
function read(o) {
  return o
    .first
    .second;
}
function readThree(o) {
  return o
    .first
    .second
    .third;
}
function readBehindComments(o) {
  return o
    // the first
    .first
    // the second
    .second;
}
function readWithCommentsAtTheEnds(o) {
  return o // what is read from
    .first // the first
    .second; // the second
}
function readOverBlankLines(o) {
  return o

    .first

    .second;
}
function readWithDotsAtTheEnds(o) {
  return o.
    first.
    second;
}
function call(o) {
  return o
    .first
    .second();
}
function callWhatIsMissing(o) {
  return o
    .first
    .missing(1, 2);
}
function callTwice(o) {
  return o
    .run()
    .next
    .run();
}
function readFromResult(o, a, b) {
  return o
    .make(a, b)
    .second;
}
function readFromResultOfArgumentsOverLines(o, a, b) {
  return o
    .make(
      a,
      b,
    )
    .second
    .third;
}
function readFromResultOfTexts(o) {
  return o
    .make("a)b", 'c]d')
    .second;
}
function readElement(o, k) {
  return o
    .first
    [k];
}
function readFromElement(o, k) {
  return o
    .list[k]
    .second;
}
function readFromElementOfPath(o, a) {
  return o
    .list[a.b]
    .second;
}
function store(o) {
  o
    .first
    .second = 1;
}
function storeValueInTheNextLine(o, v) {
  o
    .first
    .second =
      v;
}
function update(o) {
  o
    .first
    .second++;
}
function remove(o) {
  delete o
    .first
    .second;
}
function readBehindOptional(o) {
  return o
    ?.first
    .second
    .third;
}
function testKey(o) {
  return "k" in o
    .first
    .second;
}
function testInstance(o, v) {
  return v instanceof o
    .first
    .second;
}
function readOneNameTwice(o) {
  return o
    .x
    .y
    .x
    .y;
}
function readOneNameTwiceOnALine(o) {
  return o.a.x.b.x;
}
function readNameOfWhatItIsReadFrom(o) {
  return o.x.x;
}
function readNameOfWhatItIsReadFromInTheNextLine(o) {
  return o.x
    .x;
}
function readTwoChains(a, b) {
  return a
    .first
    .second + b
    .first
    .second;
}
function readInArgument(f, o) {
  return f(
    1,
    o
      .first
      .second,
  );
}
function readInTemplate(o) {
  return `${o
    .first
    .second}`;
}
function readInCondition(o) {
  if (
    o
      .first
      .second
  )
    return 1;
  return 2;
}
function readInList(o) {
  return [
    ...o
      .first
      .second,
  ];
}
function readFromBrackets(a, b) {
  return (a ||
    b)
    .first
    .second;
}
function readFromNew(K) {
  return new K()
    .first
    .second;
}
const readInArrow = o => o
  .first
  .second;
class Holder {
  read(o) {
    return this
      .inner
      .value + o;
  }
}
const none = { make() {}, list: [] };
tell("read", () => read({}));
tell("the second of three", () => readThree({}));
tell("the third of three", () => readThree({ first: {} }));
tell("behind comments", () => readBehindComments({}));
tell("comments at the ends of lines", () => readWithCommentsAtTheEnds({}));
tell("blank lines", () => readOverBlankLines({}));
tell("dots at the ends of lines", () => readWithDotsAtTheEnds({}));
tell("call", () => call({}));
tell("call of what is missing", () => callWhatIsMissing({ first: {} }));
tell("the first of two calls", () => callTwice({}));
tell("between two calls", () => callTwice({ run() { return {}; } }));
tell("the second of two calls", () => callTwice({ run() { return { next: {} }; } }));
tell("result", () => readFromResult(none, 1, 2));
tell("result of arguments over lines", () => readFromResultOfArgumentsOverLines({ make() { return {}; } }, 1, 2));
tell("result of texts", () => readFromResultOfTexts(none));
tell("element", () => readElement({}, "k"));
tell("from an element", () => readFromElement(none, 0));
tell("from an element of a path", () => readFromElementOfPath(none, {}));
tell("store", () => store({}));
tell("store of a value in the next line", () => storeValueInTheNextLine({}, 1));
tell("update", () => update({}));
tell("delete", () => remove({}));
tell("behind ?.", () => readBehindOptional({ first: {} }));
tell("in", () => testKey({ first: {} }));
tell("read in front of in", () => testKey({}));
tell("read in front of instanceof", () => testInstance({}, {}));
tell("one name twice, the first x", () => readOneNameTwice(null));
tell("one name twice, the first y", () => readOneNameTwice({}));
tell("one name twice, the second x", () => readOneNameTwice({ x: {} }));
tell("one name twice, the second y", () => readOneNameTwice({ x: { y: {} } }));
tell("one name twice on a line, the first", () => readOneNameTwiceOnALine({}));
tell("one name twice on a line, the second", () => readOneNameTwiceOnALine({ a: { x: {} } }));
tell("the name of what it is read from", () => readNameOfWhatItIsReadFrom({}));
tell("the name of what it is read from, in the next line", () => readNameOfWhatItIsReadFromInTheNextLine({}));
tell("the first of two chains", () => readTwoChains({}, { first: {} }));
tell("the second of two chains", () => readTwoChains({ first: {} }, {}));
tell("argument", () => readInArgument(() => 1, {}));
tell("template", () => readInTemplate({}));
tell("condition", () => readInCondition({}));
tell("list", () => readInList({}));
tell("brackets", () => readFromBrackets(null, {}));
tell("new", () => readFromNew(class {}));
tell("arrow", () => readInArrow({}));
tell("this", () => new Holder().read(1));
