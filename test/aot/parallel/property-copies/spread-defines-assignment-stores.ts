// A spread defines and an assignment stores under a prototype with a setter.
type Pair = { x?: number; y?: number; z?: string };
const calls: string[] = [];

const withSetter = {
  set x(value: number) { calls.push("set x " + value); },
  get x(): number { return -1; },
};
const withReadOnly = Object.defineProperty({}, "y", { value: 9, writable: false });
const plain = {};

function spreadUnder(prototype: object, pair: Pair) { return { __proto__: prototype, ...pair }; }
function spreadBehindUnder(prototype: object, pair: Pair) { return { __proto__: prototype, z: "first", ...pair }; }
function assignUnder(prototype: object, pair: Pair) { const target = { __proto__: prototype } as Pair; return Object.assign(target, pair); }
function assignBehindUnder(prototype: object, pair: Pair) { const target = { __proto__: prototype, z: "first" } as Pair; return Object.assign(target, pair); }

function show(label: string, step: () => object) {
  let text: string;
  try {
    const value = step();
    text = JSON.stringify(value) + " " + Object.keys(value).join(",") + " " + Object.hasOwn(value, "x") + " " + Object.hasOwn(value, "y");
  } catch (error) {
    text = "threw " + (error as Error).constructor.name;
  }
  console.log(label, text, calls.join(";"));
  calls.length = 0;
}

function round(name: string, prototype: object, definesFirst: boolean) {
  for (let index = 0; index < 4; index++) {
    const pair: Pair = { x: index, y: index + 1 };
    if (index & 1) pair.z = "last";
    const steps: [string, (prototype: object, pair: Pair) => object][] = [["spread", spreadUnder], ["spreadBehind", spreadBehindUnder], ["assign", assignUnder], ["assignBehind", assignBehindUnder]];
    if (!definesFirst) steps.reverse();
    for (const [label, step] of steps)
      show(name + " " + index + " " + label, () => step(prototype, pair));
  }
}

round("plain", plain, true);
round("setter", withSetter, true);
round("setter", withSetter, false);
round("read-only", withReadOnly, false);
round("read-only", withReadOnly, true);
round("plain", plain, false);

const late: Record<string, unknown> = {};
round("late", late, true);
Object.defineProperty(late, "x", { set(value: number) { calls.push("late set x " + value); }, configurable: true });
round("late with a setter", late, true);
round("late with a setter", late, false);
delete late.x;
round("late without it", late, false);
