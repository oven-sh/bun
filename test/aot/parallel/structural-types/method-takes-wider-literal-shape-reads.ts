// A method that takes a wider literal shape reads a member that is not there.
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

interface Point2 {
  x: number;
  y: number;
}
interface Point3 extends Point2 {
  z: number;
  label: string;
}

interface Plotter {
  depth(p: Point2): number;
  sum(p: Point2): number;
  title(p: Point2): string;
  raise(p: Point2): void;
  copy(p: Point2): Point3;
}

const plotter: Plotter = {
  depth(p: Point3) {
    return p.z;
  },
  sum(p: Point3) {
    return p.x + p.y + p.z;
  },
  title(p: Point3) {
    return p.label.toUpperCase();
  },
  raise(p: Point3) {
    p.z += 1;
  },
  copy(p: Point3) {
    return { ...p };
  },
};

function makers(): [string, Point2][] {
  const extra = { x: 1, y: 2, w: "extra", z: "a string called z" };
  const reordered = { label: "r", z: 30, y: 20, x: 10 };
  const whole: Point3 = { x: 1, y: 2, z: 3, label: "p" };
  return [
    ["honest", whole],
    ["flat", { x: 1, y: 2 }],
    ["another z", extra],
    ["reordered", reordered],
    ["class", new (class Flat { x = 5; y = 6; })()],
    ["honest again", reordered],
  ];
}

for (const [kind, p] of makers()) {
  show(kind + " depth", () => plotter.depth(p));
  show(kind + " sum", () => plotter.sum(p));
  show(kind + " title", () => plotter.title(p));
  show(kind + " copy", () => plotter.copy(p));
  show(kind + " raise", () => plotter.raise(p));
  show(kind + " afterwards", () => p);
  show(kind + " keys", () => Object.keys(p).join());
}

const honest: Point3 = { x: 1, y: 1, z: 1, label: "h" };
let total = 0;
for (let i = 0; i < 2000; i++) total += plotter.sum(honest);
show("2000 honest sums", () => total);
show("then a flat one", () => plotter.sum({ x: 1, y: 1 }));
show("then an honest one", () => plotter.sum(honest));
