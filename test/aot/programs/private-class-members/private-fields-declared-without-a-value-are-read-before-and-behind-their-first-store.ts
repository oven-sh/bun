// Private fields that a class declares without a value hold undefined from birth: they are read before anything is stored, behind a store, on objects that are not finished, and on objects that never had them.
function say(label: string, make: () => unknown): void {
  let text: string;
  try {
    text = String(make());
  } catch (error) {
    text = (error as Error).constructor.name;
  }
  console.log(label, text);
}

class Reply {
  #status: number | undefined;
  #text: string | undefined;
  #headers: Map<string, string> | undefined;
  #done: boolean | undefined;
  kind = "reply";
  status(): number {
    return this.#status ?? 200;
  }
  setStatus(status: number): this {
    this.#status = status;
    return this;
  }
  text(): string {
    return this.#text ?? "none";
  }
  setText(text: string | undefined): void {
    this.#text = text;
  }
  header(name: string): string | undefined {
    return this.#headers?.get(name);
  }
  setHeader(name: string, value: string): void {
    (this.#headers ??= new Map()).set(name, value);
  }
  done(): boolean | undefined {
    return this.#done;
  }
  finish(): void {
    this.#done = true;
  }
  static statusOf(value: unknown): unknown {
    return (value as Reply).#status;
  }
  static has(value: object): boolean {
    return #status in value;
  }
}

let sum = 0;
for (let turn = 0; turn < 2000; turn++) {
  const reply = new Reply();
  sum += reply.status();
  if (turn % 3 === 0) reply.setStatus(turn % 600);
  if (turn % 500 === 7) reply.setStatus(2 ** 40 + turn);
  if (turn % 500 === 9) reply.setStatus(0.5);
  sum += reply.status();
  if (turn % 5 === 0) reply.setText("t" + (turn & 7));
  if (turn % 10 === 0) reply.setText(undefined);
  sum += reply.text().length;
  if (turn % 7 === 0) reply.setHeader("a", "b" + turn);
  sum += reply.header("a")?.length ?? 1;
  if (turn % 11 === 0) reply.finish();
  sum += reply.done() ? 2 : reply.done() === undefined ? 3 : 5;
}
console.log(sum);

say("of an instance", () => Reply.statusOf(new Reply()));
say("of a stored one", () => Reply.statusOf(new Reply().setStatus(404)));
say("of a literal", () => Reply.statusOf({ kind: "reply" }));
say("of what Object.create makes", () => Reply.statusOf(Object.create(Reply.prototype)));
say("of a proxy", () => Reply.statusOf(new Proxy(new Reply(), {})));
say("of null", () => Reply.statusOf(null));
say("of a number", () => Reply.statusOf(5));
say("has: an instance", () => Reply.has(new Reply()));
say("has: what Object.create makes", () => Reply.has(Object.create(Reply.prototype)));
say("of a frozen one", () => Reply.statusOf(Object.freeze(new Reply())));
say("stored into a frozen one", () => Reply.statusOf(Object.freeze(new Reply()).setStatus(7)));

const seen: Leaky[] = [];
class Leaky {
  #first: number | undefined;
  early = seen.push(this);
  #second: string | undefined;
  #third: number | undefined = Leaky.thirdOf(this, "while it is made");
  constructor(fails: boolean) {
    if (fails) throw new RangeError("no");
  }
  static firstOf(value: Leaky): unknown {
    return value.#first;
  }
  static secondOf(value: Leaky): unknown {
    return value.#second;
  }
  static thirdOf(value: Leaky, label: string): number | undefined {
    say(label, () => value.#third);
    return undefined;
  }
}
class Stops {
  #before: number | undefined;
  stop = Stops.fail(this);
  #behind: number | undefined;
  static kept: Stops | undefined;
  static fail(value: Stops): number {
    Stops.kept = value;
    throw new EvalError("stop");
  }
  static beforeOf(value: Stops): unknown {
    return value.#before;
  }
  static behindOf(value: Stops): unknown {
    return value.#behind;
  }
}
for (let turn = 0; turn < 3; turn++) {
  say("made", () => Leaky.secondOf(new Leaky(false)));
  say("fails", () => new Leaky(true));
  say("first of what failed", () => Leaky.firstOf(seen[seen.length - 1]!));
  say("second of what failed", () => Leaky.secondOf(seen[seen.length - 1]!));
  Leaky.thirdOf(seen[seen.length - 1]!, "third of what failed");
  say("stops", () => new Stops());
  say("before", () => Stops.beforeOf(Stops.kept!));
  say("behind", () => Stops.behindOf(Stops.kept!));
}

class Hands {
  constructor(value: object) {
    return value;
  }
}
class Stamp extends Hands {
  #mark: number | undefined;
  static markOf(value: object): unknown {
    return (value as Stamp).#mark;
  }
  static mark(value: object, mark: number): void {
    (value as Stamp).#mark = mark;
  }
}
const stamped = { a: 1 };
say("before the stamp", () => Stamp.markOf(stamped));
new Stamp(stamped);
say("behind the stamp", () => Stamp.markOf(stamped));
Stamp.mark(stamped, 9);
say("marked", () => Stamp.markOf(stamped));
say("stamped twice", () => new Stamp(stamped));
const reply = new Reply();
new Stamp(reply);
say("an instance of another class, stamped", () => [Stamp.markOf(reply), Reply.statusOf(reply), reply.status()]);

class Below extends Reply {
  #status: string | undefined;
  own(): unknown {
    return this.#status;
  }
  setOwn(status: string): void {
    this.#status = status;
  }
}
const below = new Below();
say("below", () => [below.own(), below.status(), Reply.statusOf(below)]);
below.setOwn("x");
below.setStatus(3);
say("below, stored", () => [below.own(), below.status(), Reply.statusOf(below)]);
