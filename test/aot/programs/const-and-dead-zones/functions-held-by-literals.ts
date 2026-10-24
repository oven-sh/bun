// A function that an object literal, an array literal or a variable holds can run as soon as the variable that holds it is mentioned, and no earlier: a variable that such a function reads is `undefined`, or in its dead zone, exactly where plain Bun says so.
function call(holder: { read(): number }): number { return holder.read(); }
function show(...lists: unknown[]): void { console.log(lists.map(list => (list as unknown[]).flat(2).map(String).join(",")).join(" | ")); }
function attempt(run: () => unknown): unknown { try { return run(); } catch (error) { return (error as Error).constructor.name; } }

function calledEarly(): unknown[] {
  function read(): number { return state + 1; }
  var holder = { read };
  var before = holder.read();
  var state: number = 1;
  return [before, holder.read()];
}
function passedEarly(): unknown[] {
  function read(): number { return state + 1; }
  var holder = { read };
  var before = call(holder);
  var state: number = 2;
  return [before, call(holder)];
}
function nestedLiterals(): unknown[] {
  var outer = { inner: { read: function (): number { return state + 1; } }, list: [(): number => state + 2] };
  var before = [outer.inner.read(), outer.list[0]()];
  var state: number = 3;
  return [before, outer.inner.read(), outer.list[0]()];
}
function throughAnotherHolder(): unknown[] {
  var first = { read(): number { return state + 1; } };
  var second = { first };
  var before = second.first.read();
  var state: number = 4;
  return [before, second.first.read()];
}
function throughFunction(): unknown[] {
  var holder = { read(): number { return state + 1; } };
  function use(): number { return holder.read(); }
  var before = use();
  var state: number = 5;
  return [before, use()];
}
function throughHeldFunction(): unknown[] {
  function read(): number { return state + 1; }
  var inner = { read };
  var outer = { run: function (): number { return inner.read(); } };
  var before = outer.run();
  var state: number = 6;
  return [before, outer.run()];
}
function heldByVariable(): unknown[] {
  var read = function (): number { return state + 1; };
  var before = read();
  var state: number = 7;
  return [before, read()];
}
function mentionedLate(): unknown[] {
  function read(): number { return state + 1; }
  var holder = { read, more: function (): number { return other + read(); }, list: [(): number => state + other] };
  var state: number = 8;
  var other: number = 9;
  return [holder.read(), holder.more(), holder.list[0]()];
}
function returnedLate(): { read(): number } {
  var holder = { read(): number { return state + 1; } };
  var state: number = 10;
  return holder;
}
function deadZone(): unknown[] {
  const holder = { read: (): number => value + 1 };
  const before = attempt(() => holder.read());
  const value: number = 11;
  return [before, holder.read()];
}
function spreadEarly(): unknown[] {
  var holder = { get now(): number { return state + 1; } };
  var copy = { ...holder };
  var state: number = 12;
  return [copy.now, holder.now];
}
function calledInInitializer(): unknown[] {
  function read(): number { return state + 1; }
  var holder = { before: read(), read };
  var state: number = 13;
  return [holder.before, holder.read()];
}
function storedIntoHolderEarly(): unknown[] {
  var holder: { read?: () => number } = {};
  holder.read = function (): number { return state + 1; };
  var before = holder.read();
  var state: number = 14;
  return [before, holder.read()];
}
function leaveEarly(seen: unknown[]): void {
  using holder = { [Symbol.dispose](): void { seen.push(attempt(() => value + 1)); } };
  if (seen.length === 0) throw new Error("left early");
  const value: number = 19;
  seen.push(value, holder);
}
function disposedEarly(): unknown[] {
  const seen: unknown[] = [];
  seen.push(attempt(() => leaveEarly(seen)));
  return seen;
}
function storedIntoLiteralLate(): unknown[] {
  function read(): number { return state + 1; }
  var holder: { read?: () => number; more?: () => number } = {};
  holder.read = read;
  holder.more = function (): number { return state + 2; };
  var state: number = 15;
  return [holder.read(), holder.more()];
}
function storedThroughSetter(): unknown[] {
  function read(): number { return state + 1; }
  var seen: unknown[] = [];
  var holder = { set run(f: () => number) { seen.push(f()); } };
  holder.run = read;
  var state: number = 16;
  holder.run = read;
  return seen;
}
function chosen(flag: boolean, given?: () => number): unknown[] {
  function one(): number { return state + 1; }
  var pick = flag ? one : function (): number { return state + 2; };
  var fallback = given ?? one;
  var state: number = 17;
  return [pick(), fallback()];
}
function chosenAndCalledEarly(flag: boolean): unknown[] {
  function one(): number { return state + 1; }
  var pick = flag ? one : function (): number { return state + 2; };
  var before = pick();
  var state: number = 18;
  return [before, pick()];
}
show(disposedEarly(), storedIntoLiteralLate(), storedThroughSetter(), chosen(true), chosen(false), chosenAndCalledEarly(true), chosenAndCalledEarly(false));
show(calledEarly(), passedEarly(), nestedLiterals(), throughAnotherHolder(), throughFunction(), throughHeldFunction(), heldByVariable());
show(mentionedLate(), [returnedLate().read()], deadZone(), spreadEarly(), calledInInitializer(), storedIntoHolderEarly());
