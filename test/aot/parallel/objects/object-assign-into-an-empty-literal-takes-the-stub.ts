// Object.assign({}, source) of a source whose names are known only at run time is a copy: the stub in front makes it, and neither the operation nor the built-in is entered.
// COUNT: operation:operationAOTAssignToNewObject <= 200
// COUNT: operation:operationAOTObjectAssignWithoutCode <= 0
// COUNT: counter:CopiesCollectedByName <= 0
// COUNT: counter:CopiesByOrdinaryLookups <= 0
const local = Symbol("local");
function filled(): any { const made: any = {}; for (const name of ["a", "b", "c", "d"]) made[name] = name.length; return made; }
const sources: any[] = [
  { a: 1, b: 2, c: "three", d: 4 },
  JSON.parse('{"a":5,"b":6,"c":"seven","d":8}'),
  JSON.parse('{"a":1,"b":2,"c":"three","d":4,"e":5,"f":6,"g":7,"h":8,"i":9,"j":10,"k":11,"l":12}'),
  filled(),
  { a: 1, b: 2, [local]: 3, d: 4 },
  {},
  null,
  undefined,
];
function copy(source: any): any { return Object.assign({}, source); }
let names = 0;
for (let turn = 0; turn < 4000; turn++) names += Reflect.ownKeys(copy(sources[turn % sources.length])).length;
console.log(names);
for (const source of sources) console.log(JSON.stringify(copy(source)), copy(source) === source);
