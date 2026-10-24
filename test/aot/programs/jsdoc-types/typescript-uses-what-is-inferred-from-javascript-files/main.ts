import Main = require("./assigned.cjs");
import type { Row } from "./common.cjs";
import { defined, fn, Klass, named, viaModule } from "./common.cjs";
import type { Both, Point, Reducer, User } from "./esm.js";
import { add, Box, expando, frozen, open, property, shifted, table, twice } from "./esm.js";
import { one, three, two } from "./object.cjs";

const point: Point = { x: 1, y: 2 };
const user: User = { id: 1 };
const reducer: Reducer = (total, p) => total + p.x;
const both: Both<number> = { one: 1, many: [1, 2] };
const row: Row = { id: 1 };
const box: Box<number> = new Box(1);
box.init();
const late: number | undefined = box.late;
const n: number = twice(2);
const s: string = twice("a");

console.log(point.x, user.id, reducer(1, point), both.many.length, row.id, box.get() + 1, late, n, s);
console.log(shifted.call(point, 1), add(1), add(1, 2), add(1, 2, 3, 4));
console.log(expando() + expando.version, expando.nested.deep, open.a + 1, open.b.length, frozen.low + frozen.high, table.a, property.wide, property.method(1));
console.log(named + 1, fn(1), defined.length, viaModule.length, new Klass().k + 1, new Main().m + 1, one() + 1, two.length, three[0] + 1);
