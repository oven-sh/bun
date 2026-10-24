// Objects that native code made have the fields a read expects, as own properties in any order, further up their chain, or as special properties of their kind.
interface Named {
  name: string;
  length: number;
  message: string;
}

function nameOf(value: Named): unknown {
  return value.name;
}
function lengthOf(value: Named): unknown {
  return value.length;
}
function messageOf(value: Named): unknown {
  return value.message;
}
function look(mark: string, value: unknown): void {
  const named = value as Named;
  console.log(mark + ":", JSON.stringify([nameOf(named), lengthOf(named), messageOf(named)]), JSON.stringify([nameOf(named), lengthOf(named), messageOf(named)]));
}

class Listing extends Array<number> {
  name = "listing";
  message = "of numbers";
}
function declared(first: number, second: number): number {
  return first + second;
}

const honest: Named = { name: "honest", length: 1, message: "made here" };
const bare = Object.assign(Object.create(null), { message: "bare", name: "no prototype", length: -1 });
const heir = Object.create({ name: "inherited", length: 10 }, { message: { value: "own, hidden", enumerable: false } });
const failure = new RangeError("out of range");
const ownNameFailure = Object.assign(new TypeError("typed"), { name: "Renamed", length: 0.5 });

look("honest", honest);
look("parsed", JSON.parse('{"message":"m","length":2,"name":"parsed"}'));
look("parsed, other order", JSON.parse('{"length":3,"name":"parsed again","extra":null,"message":"n"}'));
look("honest", honest);
look("from entries", Object.fromEntries([["name", "entries"], ["message", 5], ["length", "six"]]));
look("cloned", structuredClone(honest));
look("no prototype", bare);
look("heir", heir);
look("error", failure);
look("error with own name", ownNameFailure);
look("function", declared);
look("arrow", (only: number) => only);
look("bound", declared.bind(null, 1));
look("class", Listing);
look("array", [1, 2, 3]);
look("array below a class", Listing.from([4, 5]));
look("array with properties", Object.assign([9], { name: "array", message: "with properties" }));
look("map with properties", Object.assign(new Map(), { name: "map", length: 4, message: "with properties" }));
look("typed array", new Uint8Array(7));
look("string object", new String("boxed"));
look("regular expression", Object.assign(/x/g, { name: "pattern" }));
look("honest", honest);

export {};
