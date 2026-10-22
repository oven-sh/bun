// The getter sits on a parent class; the instance is of a child, made by from().
const log: string[] = [];
class Parent extends Array<number> { static get [Symbol.species](): any { log.push("parent getter " + (this === Child)); return Array; } }
class Child extends Parent {}
const mapped = Child.from([1, 2]).filter(one => one > 1);
log.push(String(mapped instanceof Child), String(mapped.length));
console.log(log.join("; "));
