// Held from creation: closures that a constructor stores in fields are handed to nobody by name; Object.values, Object.entries and Reflect.get hand them back, and the program calls them with a string.
let total = 0;

class Panel {
  width = 10;
  grow = (by: number): void => {
    total += typeof by === "number" ? this.width + by : 1000 + String(by).length;
  };
  shrink = (by: number): void => {
    total += typeof by === "number" ? this.width - by : 100000 + String(by).length;
  };
}

const panel = new Panel();
panel.grow(1);
panel.shrink(1);
for (const value of Object.values(panel) as any[]) if (typeof value === "function") value("text");
for (const [, value] of Object.entries(panel) as [string, any][]) if (typeof value === "function") value(undefined);
for (const key of Reflect.ownKeys(panel)) {
  const value: any = Reflect.get(panel, key);
  if (typeof value === "function") value({ toString: () => "object" });
}
console.log(total);
