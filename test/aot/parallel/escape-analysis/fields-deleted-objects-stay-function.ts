// `delete` of a named field of an object that never leaves its function, that leaves it later, or that leaves it on one path alone: what is left, in which order, and what the deletion answers.
const lines: string[] = [];
function say(label: string, value: unknown): void {
  lines.push(label + ": " + (typeof value === "string" ? value : JSON.stringify(value)));
}
const kept: object[] = [];
function keep<T extends object>(value: T): T {
  kept.push(value);
  if (kept.length > 8) kept.shift();
  return value;
}

type Message = { id: number; draft?: boolean; text: string };

function neverLeaves(i: number): number {
  const message: Message = { id: i, draft: true, text: "hi" };
  const answer = delete message.draft;
  return message.id + message.text.length + ("draft" in message ? 100 : 0) + (answer ? 1000 : 0) + (message.draft === undefined ? 10000 : 0);
}

function leavesBehindTheDeletion(i: number): Message {
  const message: Message = { id: i, draft: true, text: "hi" };
  delete message.draft;
  return keep(message);
}

function storedAgain(i: number): Message {
  const message: Message = { id: i, draft: true, text: "hi" };
  delete message.draft;
  message.draft = (i & 1) === 0;
  return keep(message);
}

function storedAgainAndNeverLeaves(i: number): string {
  const message: Message = { id: i, draft: true, text: "hi" };
  delete message.draft;
  message.draft = false;
  return Object.keys(message).join() + "|" + message.draft;
}

function deletedOnOnePath(i: number): Message {
  const message: Message = { id: i, draft: true, text: "hi" };
  if (i % 3 === 0) delete message.draft;
  return keep(message);
}

function deletedOnOnePathAndRead(i: number): string {
  const message: Message = { id: i, draft: true, text: "hi" };
  if (i % 3 === 0) delete message.draft;
  return ("draft" in message) + "," + message.draft + "," + Object.keys(message).length + "," + Object.hasOwn(message, "draft");
}

function deletedTwice(i: number): string {
  const message: Message = { id: i, draft: true, text: "hi" };
  const first = delete message.draft;
  const second = delete message.draft;
  return first + "," + second + "," + JSON.stringify(message);
}

function deletedThoughNeverThere(i: number): string {
  const message: Message = { id: i, text: "hi" };
  const answer = delete message.draft;
  return answer + "," + JSON.stringify(message);
}

function deletedInALoop(n: number): string {
  const message: Message = { id: n, draft: true, text: "hi" };
  let seen = 0;
  for (let i = 0; i < n; i++) {
    if ("draft" in message) {
      seen++;
      delete message.draft;
    } else message.draft = i % 2 === 0;
  }
  return seen + "," + JSON.stringify(message);
}

function theFirstKeyGoes(i: number): string {
  const pair: { a?: number; b: number; c: number } = { a: i, b: i + 1, c: i + 2 };
  delete pair.a;
  pair.a = 7;
  return JSON.stringify(keep(pair)) + Object.keys(pair).join("");
}

function everyKeyGoes(i: number): string {
  const pair: { a?: number; b?: number } = { a: i, b: i + 1 };
  delete pair.b;
  delete pair.a;
  return JSON.stringify(pair) + Object.keys(pair).length + ("a" in pair) + ("b" in pair);
}

function theDeletedFieldHeldAnObject(i: number): number {
  const outer: { inner?: { n: number }; m: number } = { inner: { n: i }, m: 2 };
  const inner = outer.inner!;
  delete outer.inner;
  inner.n += 5;
  return inner.n + outer.m + (outer.inner === undefined ? 100 : 0);
}

function theDeletedFieldHeldAnObjectThatLeaves(i: number): string {
  const outer: { inner?: { n: number }; m: number } = { inner: { n: i }, m: 2 };
  const inner = outer.inner!;
  delete outer.inner;
  keep(inner);
  keep(outer);
  return JSON.stringify(inner) + JSON.stringify(outer);
}

const above = { draft: "from above" };
function thePrototypeShowsThrough(i: number): string {
  const message: { id: number; draft?: string } = { id: i, draft: "own" };
  Object.setPrototypeOf(message, above);
  const before = message.draft;
  delete message.draft;
  return before + "," + message.draft + "," + ("draft" in message) + "," + Object.hasOwn(message, "draft");
}

class Point {
  x: number;
  y?: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  sum(): number {
    return this.x + (this.y ?? -1);
  }
}
function aFieldOfAnInstance(i: number): string {
  const point = new Point(i, i + 1);
  const before = point.sum();
  delete point.y;
  return before + "," + point.sum() + "," + Object.keys(point).join();
}
function aFieldOfAnInstanceThatLeaves(i: number): string {
  const point = new Point(i, i + 1);
  delete point.y;
  keep(point);
  return point.sum() + "," + JSON.stringify(point) + "," + (point instanceof Point);
}

function aRequiredFieldByACast(i: number): string {
  const message = { id: i, text: "hi" };
  delete (message as { id?: number }).id;
  return JSON.stringify(keep(message)) + "," + message.id + "," + ("id" in message);
}

function frozenFirst(i: number): string {
  "use strict";
  const message: Message = { id: i, draft: true, text: "hi" };
  Object.freeze(message);
  try {
    delete message.draft;
    return "deleted " + JSON.stringify(message);
  } catch (error) {
    return (error as Error).constructor.name + " " + JSON.stringify(message);
  }
}

function definedAsFixed(i: number): string {
  const message: Message = { id: i, text: "hi" };
  Object.defineProperty(message, "draft", { value: true, configurable: false, enumerable: true, writable: true });
  try {
    const answer = delete message.draft;
    return answer + " " + JSON.stringify(message);
  } catch (error) {
    return (error as Error).constructor.name + " " + JSON.stringify(message);
  }
}

function anAccessorGoes(i: number): string {
  const holder: { n: number; twice?: number } = {
    n: i,
    get twice() {
      return this.n * 2;
    },
  };
  const before = holder.twice;
  const answer = delete holder.twice;
  return before + "," + answer + "," + holder.twice + "," + Object.keys(holder).join();
}

function aMethodGoes(i: number): string {
  const holder: { n: number; twice?(): number } = {
    n: i,
    twice() {
      return this.n * 2;
    },
  };
  const before = holder.twice!();
  delete holder.twice;
  return before + "," + typeof holder.twice + "," + Object.keys(holder).join();
}

function thrownOverTheDeletion(i: number): string {
  const message: Message = { id: i, draft: true, text: "hi" };
  try {
    delete message.draft;
    if (i % 2) throw new Error("odd");
    message.draft = false;
  } catch {
    return "caught " + JSON.stringify(message);
  }
  return "passed " + JSON.stringify(message);
}

function spreadBehindTheDeletion(i: number): string {
  const message: Message = { id: i, draft: true, text: "hi" };
  delete message.draft;
  const copy = { ...message, more: 1 };
  return JSON.stringify(copy) + Object.keys(copy).join();
}

function walkedBehindTheDeletion(i: number): string {
  const message: Message = { id: i, draft: true, text: "hi" };
  delete (message as { text?: string }).text;
  let names = "";
  for (const name in message) names += name + ";";
  return names + Object.entries(message).join("|");
}

for (let round = 0; round < 40; round++) {
  const i = round;
  const all: [string, unknown][] = [
    ["neverLeaves", neverLeaves(i)],
    ["leavesBehindTheDeletion", leavesBehindTheDeletion(i)],
    ["storedAgain", storedAgain(i)],
    ["storedAgain keys", Object.keys(storedAgain(i)).join()],
    ["storedAgainAndNeverLeaves", storedAgainAndNeverLeaves(i)],
    ["deletedOnOnePath", deletedOnOnePath(i)],
    ["deletedOnOnePathAndRead", deletedOnOnePathAndRead(i)],
    ["deletedTwice", deletedTwice(i)],
    ["deletedThoughNeverThere", deletedThoughNeverThere(i)],
    ["deletedInALoop", deletedInALoop(i)],
    ["theFirstKeyGoes", theFirstKeyGoes(i)],
    ["everyKeyGoes", everyKeyGoes(i)],
    ["theDeletedFieldHeldAnObject", theDeletedFieldHeldAnObject(i)],
    ["theDeletedFieldHeldAnObjectThatLeaves", theDeletedFieldHeldAnObjectThatLeaves(i)],
    ["thePrototypeShowsThrough", thePrototypeShowsThrough(i)],
    ["aFieldOfAnInstance", aFieldOfAnInstance(i)],
    ["aFieldOfAnInstanceThatLeaves", aFieldOfAnInstanceThatLeaves(i)],
    ["aRequiredFieldByACast", aRequiredFieldByACast(i)],
    ["frozenFirst", frozenFirst(i)],
    ["definedAsFixed", definedAsFixed(i)],
    ["anAccessorGoes", anAccessorGoes(i)],
    ["aMethodGoes", aMethodGoes(i)],
    ["thrownOverTheDeletion", thrownOverTheDeletion(i)],
    ["spreadBehindTheDeletion", spreadBehindTheDeletion(i)],
    ["walkedBehindTheDeletion", walkedBehindTheDeletion(i)],
  ];
  if (round < 4 || round === 39) for (const [label, value] of all) say(round + " " + label, value);
}
say("kept", kept);
console.log(lines.join("\n"));
