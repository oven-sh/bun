function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Cell {
  count = 1;
  ready = false;
  title = "a";
  run: () => number = () => 1;
  other = 5;
}

function describe(c: Cell): string {
  return [c.count + 1, c.count * 2, c.ready ? "ready" : "not ready", c.title + "!", c.title.length, c.run(), c.other].join(" ");
}

function change(c: Cell): void {
  Reflect.set(c, "count", 2.5);
  Reflect.set(c, "ready", true);
  Reflect.set(c, "title", "bcd");
  Reflect.set(c, "run", () => 2);
}

let sum = 0;
for (let i = 0; i < 2000; i++) {
  const c = new Cell();
  sum += c.count + c.run() + (c.ready ? 1 : 0) + c.title.length;
}
say("honest rounds", sum);
const cell = new Cell();
say("before", describe(cell));
change(cell);
say("count", cell.count);
say("count plus one", cell.count + 1);
say("ready", cell.ready);
say("ready picks", cell.ready ? "ready" : "not ready");
say("title", cell.title);
say("run", cell.run());
say("after", describe(cell));
say("a fresh cell", describe(new Cell()));
