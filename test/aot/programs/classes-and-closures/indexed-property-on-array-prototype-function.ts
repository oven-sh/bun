// Once an array inherits from a function, an accessor or a read-only property at an index of the function answers for the holes of the
// array and stands in the way of stores to them.
const lines: string[] = [];
const say = (what: string, value: unknown) => lines.push(what + ": " + String(value));
const outcome = (run: () => void) => {
  try {
    run();
    return "stored";
  } catch (error) {
    return (error as Error).constructor.name;
  }
};
for (const [name, f] of [
  ["expression", function () {}],
  ["arrow", () => {}],
] as [string, any][]) {
  const list: any = [1, , 3];
  Object.setPrototypeOf(list, f);
  say(name + " a hole before", list[1]);
  Object.defineProperty(f, 1, { get: () => name + " answers", configurable: true });
  Object.defineProperty(f, 4, { value: name + " is read-only", writable: false, configurable: true });
  let seen: unknown = "nothing";
  Object.defineProperty(f, 5, {
    set(value: unknown) {
      seen = value;
    },
    configurable: true,
  });
  say(name + " a hole", list[1]);
  say(name + " an element", list[0] + list[2]);
  say(name + " beyond the end", list[4]);
  say(name + " a store below a getter", outcome(() => (list[1] = 2)));
  say(name + " a store below a read-only property", outcome(() => (list[4] = 2)));
  say(name + " a store below a setter", outcome(() => (list[5] = "sent")));
  say(name + " the setter saw", seen);
  say(name + " length", Array.prototype.push.call(list, 9) + " " + list.length);
  say(name + " own keys", Object.keys(list).join());
  const heir = Object.create(f);
  say(name + " an heir that is no array", heir[1] + " | " + heir[4]);
}
const others: number[] = [];
for (let i = 0; i < 50; i++) others.push(i);
others[80] = 1;
say("other arrays", others.length + " " + others[7] + " " + others[60]);
console.log(lines.join("\n"));
