// Classes of the program that extend Promise, RegExp, Date, Object, Function and the wrappers of primitives.
const say = (...values) => console.log(...values);

class Task extends Promise {
  static made = 0;
  label = "task";
  constructor(executor) { super(executor); Task.made++; }
  then(onFulfilled, onRejected) { Task.thens = (Task.thens ?? 0) + 1; return super.then(onFulfilled, onRejected); }
  describe() { return `${this.label} ${this instanceof Task}`; }
}
const task = new Task(resolve => resolve({ answer: 42 }));
const chained = task.then(value => value.answer + 1);
say(task.describe(), chained instanceof Task, chained.describe(), Task.made, Task.resolve(1) instanceof Task, Task.reject(new Error("refused")).catch(error => error.message) instanceof Task);
say(await chained, (await task).answer, await Task.all([1, Task.resolve(2)]).then(values => values.length), Task.thens > 0, await Task.resolve(5).finally(() => {}), Task.withResolvers().promise instanceof Task);
class Ordinary extends Promise { static get [Symbol.species]() { return Promise; } }
say(new Ordinary(resolve => resolve(1)).then(n => n) instanceof Ordinary, await new Ordinary(resolve => resolve("plain")).then(text => text.length));
try { new Task(); } catch (error) { say(error instanceof TypeError); }
say(await new Task(() => { throw new RangeError("thrown in the executor"); }).catch(error => error.message), await (async () => await new Task(resolve => setTimeout(resolve, 1, "later")))());

class Word extends RegExp {
  uses = 0;
  constructor(text, flags) { super(`\\b${text}\\b`, flags); }
  exec(text) { this.uses++; return super.exec(text); }
  static get [Symbol.species]() { return RegExp; }
}
const word = new Word("cat", "g");
say(word.test("a cat sat"), word.uses, word.source, word.flags, word.lastIndex, "cat cat".replace(word, "dog"), word.uses > 1, "a cat".match(new Word("cat")).index, word instanceof RegExp);
say("one cat two".split(new Word("cat")).length, [..."cat cat".matchAll(new Word("cat", "g"))].length, new (class extends RegExp {})(/x/g).flags, new (class extends RegExp {})({ [Symbol.match]: true, source: "s", flags: "i", constructor: 1 }).flags);

class Day extends Date {
  note = "day";
  get isEpoch() { return this.getTime() === 0; }
  toJSON() { return `day ${this.getTime()}`; }
}
say(new Day(0).isEpoch, new Day(86400000).getUTCDate(), new Day(0).note, JSON.stringify([new Day(5)]), new Day(2020, 0, 1).getFullYear(), new Day("1970-01-01T00:00:01Z").getTime(), new Day({ valueOf: () => 7 }).getTime(), typeof new Day().getTime(), new Day(0) instanceof Date);

class Record extends Object { constructor(value) { super(value); this.own = true; } }
say(new Record().own, new Record({ ignored: 1 }).ignored, Object.getPrototypeOf(new Record()) === Record.prototype, new Record().toString(), Object.keys(new Record()).join());
class Text extends String { shout() { return this.toUpperCase() + "!"; } }
say(new Text("hey").shout(), new Text("hey").length, new Text("hey")[1], `${new Text(5)}`, new Text("a") + "b", new Text("hey") instanceof String, Object.keys(new Text("ab")).join());
class Amount extends Number { double() { return this * 2; } }
class Flag extends Boolean { flip() { return !this.valueOf(); } }
say(new Amount(21).double(), new Amount("4") + 1, new Amount(1.5).toFixed(2), new Flag(0).flip(), new Flag(1).flip(), typeof new Flag(1));

say(Reflect.construct(Promise, [resolve => resolve(1)], Task) instanceof Task, Reflect.construct(Promise, [resolve => resolve(1)], Task).label, Reflect.construct(Date, [0], Day).isEpoch, Reflect.construct(RegExp, ["x"], Word).uses, Reflect.construct(String, ["s"], Text).shout());
