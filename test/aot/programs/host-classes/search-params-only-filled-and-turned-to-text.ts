// `const params = new URLSearchParams()` that is only filled by set | append and turned to text by toString() is compiled without the object. For every name and value that is a string the text is plain Bun's; so it is where the object is used in another way, and where `URLSearchParams` is another class. A primitive of another kind does not get past `as string`: the cast throws a TypeError before the host converts anything. An object passes the cast, and the host converts it as in plain Bun.
function address(state: string, label: string | null, page: number): string {
  const params = new URLSearchParams();
  if (state !== "open") params.set("state", state);
  if (label !== null) params.set("label", label);
  if (page !== 1) params.set("page", String(page));
  const query = params.toString();
  return `/issues${query && `?${query}`}`;
}
function appended(names: unknown[], values: unknown[]): string {
  const params = new URLSearchParams();
  params.append(names[0] as string, values[0] as string);
  params.append(names[1] as string, values[1] as string);
  params.set(names[2] as string, values[2] as string);
  params.append(names[3] as string, values[3] as string);
  return params.toString() + "|" + params.toString();
}
function inALoop(pairs: [string, string][], replaces: boolean): string {
  const params = new URLSearchParams();
  for (const [name, value] of pairs) {
    if (replaces) params.set(name, value);
    else params.append(name, value);
  }
  return params.toString();
}
function asked(name: string): string {
  const params = new URLSearchParams();
  params.set(name, "1");
  return params.toString() + params.size + params.has(name);
}
function handedOn(name: string): string {
  const params = new URLSearchParams();
  params.set(name, "1");
  return String(new URLSearchParams(params));
}
function interpolated(name: string): string {
  const params = new URLSearchParams();
  params.set(name, "1");
  return `?${params}`;
}
function captured(name: string): string {
  const params = new URLSearchParams();
  const fill = () => params.set(name, "1");
  fill();
  return params.toString();
}
function say(label: string, work: () => unknown) {
  try {
    console.log(label, JSON.stringify(work()));
  } catch (error) {
    console.log(label, "throws", (error as Error).constructor.name);
  }
}
const texts = ["", "a", "closed", "two words", "a&b=c", "100%", "café", "東京", "😀", "lone \ud83d", "\ude00 lone", "*-._~", "+", "\u0000\n\r\t", "A-Z_0.9*", "'()!", " "];
for (const text of texts) {
  say("address", () => address(text, text, text.length));
  say("address, nothing set", () => address("open", null, 1));
  say("names", () => appended([text, "b", text, text], ["1", text, "3", "4"]));
  say("asked", () => asked(text));
  say("handed on", () => handedOn(text));
  say("interpolated", () => interpolated(text));
  say("captured", () => captured(text));
}
say("set replaces the first and drops the rest", () => appended(["a", "a", "a", "b"], ["1", "2", "3", "4"]));
say("set appends", () => appended(["a", "b", "c", "a"], ["1", "2", "3", "4"]));
say("two lone halves are one name", () => appended(["\ud83d", "\ud83e", "\ude00", "x"], ["1", "2", "3", "4"]));
say("values that are not texts", () => appended(["a", "b", "c", "d"], [1.5, null, undefined, true]));
say("objects", () => appended(["a", "b", "c", "d"], [{ toString: () => "<o>" }, [1, 2], 12n, { valueOf: () => "v", toString: () => "t" }]));
const order: string[] = [];
const noted = (text: string) => ({ toString: () => (order.push(text), text) });
say("a symbol", () => appended(["a", "b", "c", "d"], ["1", Symbol("s"), "3", "4"]));
say("a symbol as a name", () => appended([Symbol("n"), "b", "c", "d"], [noted("never"), "2", "3", "4"]) + order.join());
say("an object that gives a symbol", () => appended(["a", "b", "c", "d"], [{ toString: () => Symbol("t") }, "2", "3", "4"]));
say("the order of conversions", () => appended([noted("n0"), noted("n1"), "c", "d"], [noted("v0"), noted("v1"), "3", "4"]) + order.join());
say("a conversion that throws", () => appended(["a", "b", "c", "d"], ["1", { toString: () => { throw new RangeError("no text"); } }, "3", "4"]));
say("a loop that appends", () => inALoop([["a", "1"], ["b", "2"], ["a", "3"], ["c d", "4 5"]], false));
say("a loop that sets", () => inALoop([["a", "1"], ["b", "2"], ["a", "3"], ["a", "4"], ["b", "é"]], true));
say("nothing", () => inALoop([], true));
let length = 0;
for (let round = 0; round < 20000; round++) {
  length += address(round % 2 ? "open" : "closed", round % 3 ? null : "bug " + round, round % 5).length;
  if (round % 5000 === 0) Bun.gc(true);
}
console.log(length);
const Original = globalThis.URLSearchParams;
class Other {
  said: string[] = [];
  set(name: string, value: string) {
    this.said.push(`set ${name} ${value}`);
  }
  append(name: string, value: string) {
    this.said.push(`append ${name} ${value}`);
  }
  toString() {
    return this.said.join(";");
  }
}
(globalThis as any).URLSearchParams = Other;
say("another class", () => address("closed", "x", 2));
say("another class, appended", () => appended(["a", "b", "c", "d"], ["1", "2", "3", "4"]));
(globalThis as any).URLSearchParams = Original;
say("the class again", () => address("closed", "x", 2));
