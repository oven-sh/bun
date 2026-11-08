// What every program of this family asks: each kind of value, each class, in each kind of place. A program lays its deed between two rounds.
export const lines = [];
export function Crate(weight) {
  this.weight = weight;
}
Crate.prototype.weigh = function () {
  return this.weight;
};
export function Pallet(weight) {
  Crate.call(this, weight);
  this.height = 2;
}
Object.setPrototypeOf(Pallet.prototype, Crate.prototype);
export class Parcel {
  constructor(weight) {
    this.weight = weight;
  }
}
export class Letter extends Parcel {}
export class Stranger {}

const shelf = {};
let places = 0;
export function lose(value) {
  const place = "place" + (places++ % 7);
  shelf[place] = value;
  return shelf[place];
}

export function makeThings() {
  return {
    crate: new Crate(1),
    pallet: new Pallet(2),
    parcel: new Parcel(3),
    letter: new Letter(4),
    stranger: new Stranger(),
    belowCrate: Object.create(Crate.prototype),
    belowNothing: Object.create(null),
    literal: { weight: 5 },
    list: [6],
    closure: function () {},
    number: 7,
    text: "eight",
    nothing: null,
    absent: undefined,
    symbol: Symbol("nine"),
    big: 10n,
    truth: true,
    proxyOfCrate: new Proxy(new Crate(11), {}),
    proxyThatTells: new Proxy(
      {},
      {
        getPrototypeOf() {
          lines.push("  the proxy is asked for its prototype");
          return Parcel.prototype;
        },
      },
    ),
  };
}

function say(answer) {
  return answer === true ? "y" : answer === false ? "n" : String(answer);
}
function small(value, Class) {
  return value instanceof Class;
}
function straight(value, Class) {
  const lost = lose(value);
  return lost instanceof Class;
}
function ofCrate(value) {
  return lose(value) instanceof Crate;
}
function ofParcel(value) {
  return lose(value) instanceof Parcel;
}
function inLoop(value) {
  let count = 0;
  for (let i = 0; i < 3; i++) if (lose(value) instanceof Crate) count++;
  for (let i = 0; i < 3; i++) if (lose(value) instanceof Parcel) count += 10;
  return count;
}
function inHandler(value) {
  try {
    throw value;
  } catch (caught) {
    return say(caught instanceof Crate) + say(caught instanceof Parcel);
  }
}
function copiedInLine(value) {
  return say(small(lose(value), Crate)) + say(small(lose(value), Parcel));
}
async function inAsyncBody(value) {
  const first = lose(value) instanceof Crate;
  await null;
  return say(first) + say(lose(value) instanceof Parcel);
}
function* inGenerator(value) {
  yield lose(value) instanceof Crate;
  yield lose(value) instanceof Parcel;
}

export async function round(title, things, more = {}) {
  lines.push(title);
  for (const name of Object.keys(things)) {
    const value = things[name];
    let line = name + ":";
    const ask = (label, question) => {
      try {
        line += " " + label + "=" + question();
      } catch (error) {
        line += " " + label + "=" + error.constructor.name;
      }
    };
    ask("crate", () => say(ofCrate(value)));
    ask("parcel", () => say(ofParcel(value)));
    ask("pallet", () => say(straight(value, Pallet)));
    ask("letter", () => say(straight(value, Letter)));
    ask("stranger", () => say(straight(value, Stranger)));
    ask("loop", () => inLoop(value));
    ask("handler", () => inHandler(value));
    ask("copied", () => copiedInLine(value));
    ask("generator", () => [...inGenerator(value)].map(say).join(""));
    for (const label of Object.keys(more)) ask(label, () => say(straight(value, more[label])));
    try {
      line += " async=" + (await inAsyncBody(value));
    } catch (error) {
      line += " async=" + error.constructor.name;
    }
    lines.push(line);
  }
}
export function tell() {
  console.log(lines.join("\n"));
}
