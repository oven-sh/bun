class Above { id: number; name: string;
  constructor(id: number) { let work = 0; for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) work = (work + i * k) | 0; this.id = id + work; this.name = "n" + id; } }
class Below extends Above { size: number; constructor(id: number, size: number) { super(id); this.size = size; } }
class Lowest extends Below { deep: boolean; constructor(id: number) { super(id, id * 2); this.deep = (id & 1) === 1; } }
function tell(x: Above): string { return x.id + x.name; }
function tellBelow(x: Below): string { return tell(x) + ":" + x.size; }
function tellLowest(x: Lowest): string { return tellBelow(x) + ":" + x.deep; }
let text = "";
for (let i = 0; i < 300; i++) text = tell(new Above(i)) + " " + tellBelow(new Below(i, i + 1)) + " " + tellLowest(new Lowest(i));
console.log(text);
console.log(tellBelow(Reflect.construct(Below, [4, 5])), tell(Reflect.construct(Above, [6], Lowest)), Reflect.construct(Above, [6], Lowest) instanceof Lowest);
export {};
