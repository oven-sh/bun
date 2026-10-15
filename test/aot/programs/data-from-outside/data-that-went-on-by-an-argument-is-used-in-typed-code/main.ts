// Data from outside is looked at as one type, and a function of another module hands it on as an argument of a second type with the same properties. What is read out of it is used in typed code: joined to a string, put into a template, compared, stored in an array. Whatever the data holds is there: no runtime type check refuses it. The module that is compiled first calls that function, so the compiler has looked into its body, and has resolved the call there, before it comes to check it.
import { pass } from "./pass";
import { viaPass } from "./types";
import { load } from "./load";

const odd = pass(load('{"id":"seven","name":null,"more":true}'));
const joined = "id " + odd.id;
const written = `name ${odd.name}`;
console.log(joined, written, odd.id === 7, [odd.id, odd.name].length);

const short = viaPass(load('{"id":8}'));
const sum = "" + short.id + short.name;
console.log(sum, typeof short.name);
