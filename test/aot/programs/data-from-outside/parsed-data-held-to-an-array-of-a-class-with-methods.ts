// Parsed data has no methods. Held to an array of a class that has one, it does not fit the type, and the program finds out where plain Bun finds out: its fields are read, `instanceof` says false, and the call of the method is the TypeError, not the read of the element.
class Shouting { field: string = "made"; shout(): string { return this.field.toUpperCase(); } }
function row(name: string, run: () => unknown) { try { console.log(name + ": " + String(run())); } catch (error) { console.log(name + ": THROWS " + (error as Error).name); } }
const list: Shouting[] = JSON.parse('[{"field":"given"}]');
list.push(new Shouting());
row("the element", () => typeof list[0]);
row("its field", () => list[0].field);
row("instanceof", () => list[0] instanceof Shouting);
row("its method", () => list[0].shout());
row("whether it has the method", () => "shout" in list[0]);
row("the one that was made", () => list[1].shout() + " " + (list[1] instanceof Shouting));
row("all fields", () => list.map(each => each.field).join());
row("all methods", () => list.map(each => each.shout()).join());
