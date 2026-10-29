// Side effects of definitions happen in source order.
function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

const log: string[] = [];

function mark(label: string): string {
  log.push(label);
  return label;
}

mark("start");

class First {
  static a: string = mark("First.a");
  static {
    mark("First block");
  }
  static b: string = mark("First.b");
  field: string = mark("First field");
}

mark("between first and unused");

class Unused {
  static only: string = mark("Unused.only");
  static {
    mark("Unused block");
  }
  [mark("unusedKey")](): void {}
}

mark("between unused and second");

class Second extends (mark("Second extends"), First) {
  static c: string = mark("Second.c");
  [mark("secondKey")](): void {}
  static [mark("secondStaticKey")](): void {}
  other: string = mark("Second field");
}

const expressions = [
  class {
    static x: string = mark("expression one");
  },
  class {
    static x: string = mark("expression two");
  },
];

enum Computed {
  A = mark("enum A").length,
  B = mark("enum B").length,
}

namespace Space {
  mark("namespace body");
  export const value: string = mark("namespace value");
}

const literal = {
  [mark("literal key one")]: mark("literal value one"),
  [mark("literal key two")]: mark("literal value two"),
};

function hoisted(): string {
  return mark("hoisted called");
}
hoisted.tag = mark("hoisted tag");

mark("before instances");
new Second();
new First();
mark("end");

for (const entry of log) console.log(entry);
show("count", () => log.length);
show("expressions", () => expressions.map(e => e.x).join());
show("enum", () => Computed.A + Computed.B);
show("namespace", () => Space.value);
show("literal", () => Object.keys(literal).join());
show("first", () => First.a + First.b);
show("second", () => Second.c + Second.a);
