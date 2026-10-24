// What `bun run` drops of a script that has code is global, as for tsc and `bun check`: an interface, a type alias, and `declare function`, `namespace`, `class` and `enum`, whose values its code puts on globalThis. A name that another file has declared stays the script's own: `Node` here, and `Shape` in the second script.
import "./declares";
import "./second";
const shape: Shape = { sides: 4 };
const level: Level = "high";
console.log(shape.sides, level, describe(shape), Units.perMeter, new Meter(2).length, Kind.Second);
