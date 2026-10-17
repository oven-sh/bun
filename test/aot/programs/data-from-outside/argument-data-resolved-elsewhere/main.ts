// Data from outside is looked at as one type, and a function of another module hands it on as an argument of a second type with the same properties. It stays the same object, and whatever the data holds is there: no runtime type check refuses it. The module that is compiled first calls that function, so the compiler has looked into its body, and has resolved the call there, before it comes to check it.
import { pass } from "./pass";
import { viaPass, type Line } from "./types";
import { load } from "./load";

const row = load('{"id":1,"name":"parsed"}');
const line = pass(row);
console.log(row === (line as unknown), line.id, line.name);
line.id = 2;
console.log(row.id, line.id);

const odd = pass(load('{"id":"seven","name":null,"more":true}'));
console.log(odd.id, odd.name, Object.keys(odd).join());
const short = viaPass(load('{"id":8}'));
console.log(short.id, short.name, Object.keys(short).join());

const own: Line = { id: 3, name: "made here" };
console.log(own.id, own.name, JSON.stringify(own));
