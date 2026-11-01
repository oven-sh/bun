// `this[kHeaders] + this[kStatus] + this.id` in a method that is put in line in a hot loop. All that the program shows
// says that the three are numbers. The third member is read between the sum of the first two and the second +.
// The constructor also stores what a list of keys and values names, and that list grows while the program runs: then
// the first two are no numbers, or the third, or all, and the sum so far has to reach the second + as it was made.
const symbols = {
  kHeaders: Symbol("reply.headers"),
  kSent: Symbol("reply.sent"),
  kIsError: Symbol("reply.isError"),
  kStatus: Symbol("reply.status"),
};
const { kHeaders, kSent, kIsError, kStatus } = symbols;
function Reply(this: any, raw: unknown, id: number) {
  this.raw = raw;
  this[kIsError] = false;
  this.id = id;
  this[kHeaders] = 0;
  this[kStatus] = 200;
}
Reply.props = [] as { key: string | symbol; value: unknown }[];
Object.defineProperties(Reply.prototype, {
  sent: {
    enumerable: true,
    get(this: any) {
      return (this[kSent] || this.raw.ended) === true;
    },
  },
});
Reply.prototype.header = function (this: any, size: number) {
  this[kHeaders] += size;
  return this;
};
Reply.prototype.send = function (this: any): number {
  if (this.sent || this[kIsError]) return 0;
  return this[kHeaders] + this[kStatus] + this.id;
};
function buildReply(R: any) {
  const props = R.props.slice();
  function _Reply(this: any, raw: unknown, id: number) {
    this.raw = raw;
    this[kIsError] = false;
    this[kSent] = false;
    this.id = id;
    this[kHeaders] = 0;
    this[kStatus] = 200;
    for (let i = 0; i < props.length; i++) {
      const prop = props[i];
      this[prop.key] = prop.value;
    }
  }
  Object.setPrototypeOf(_Reply.prototype, R.prototype);
  Object.setPrototypeOf(_Reply, R);
  _Reply.props = props;
  return _Reply;
}
Reply.props.push({ key: process.argv.length > 99 ? process.argv[9]! : "user", value: undefined });
const context = new Function("context", "return context" + String(Date.now()).slice(99))({ Reply: buildReply(Reply) });
const raw = { ended: false };
function turn(i: number): number {
  const reply = new context.Reply(raw, i & 7);
  return reply.header(1).header(2).send();
}
function bench(n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum + turn(i)) | 0;
  return sum;
}
function describe(value: unknown): string {
  return typeof value + ":" + (Object.is(value, -0) ? "-0" : String(value));
}
function show(label: string) {
  try {
    console.log(label, describe(turn(3)), bench(500));
  } catch (error) {
    console.log(label, (error as Error).constructor.name);
  }
}
console.log("numbers", bench(300000));
const seven = { valueOf: () => 7 };
const values: unknown[] = [0.5, -0, 2147483647, NaN, "x", "12", "", null, undefined, true, seven, [1, 2], 5n];
const props = context.Reply.props;
for (const key of [kHeaders, kStatus, "id"]) {
  for (const value of values) {
    props.push({ key, value });
    show(String(key) + " " + describe(value));
    props.pop();
  }
}
for (const second of values) {
  for (const third of values) {
    props.push({ key: kStatus, value: second }, { key: "id", value: third });
    show(describe(second) + " " + describe(third));
    props.length -= 2;
  }
}
console.log("numbers again", bench(300000));
