// An anonymous function or class takes the name of the identifier it is assigned to. Bun's transpiler erases parentheses and type syntax around that identifier first.
function namesOf(...values: any[]): string {
  return JSON.stringify(values.map(value => value.name));
}

let plain: any, parenthesized: any, cast: any, asserted: any, nested: any;
plain = function () {};
(parenthesized) = function () {};
(cast as any) = () => {};
asserted! = class {};
((nested as any)!) = function () {};
console.log(namesOf(plain, parenthesized, cast, asserted, nested));

let or: any, and: any = 1, nullish: any;
(or) ||= function () {};
(and as any) &&= () => {};
nullish! ??= class {};
console.log(namesOf(or, and, nullish));

let element: any, parenthesizedElement: any, castElement: any, assertedElement: any;
[
  element = function () {},
  (parenthesizedElement) = function () {},
  (castElement as any) = () => {},
  assertedElement! = class {},
] = [] as any[];
console.log(namesOf(element, parenthesizedElement, castElement, assertedElement));

let property: any, castProperty: any, shorthand: any;
({ a: (property) = function () {}, b: (castProperty as any) = () => {}, shorthand = class {} } = {} as any);
console.log(namesOf(property, castProperty, shorthand));

let head: any;
for ([(head) = function () {}] of [[]] as any[][]) console.log(namesOf(head));
for ({ a: head! = () => {} } of [{}] as any[]) console.log(namesOf(head));

let parenthesizedValue: any, castValue: any, ownName: any;
(parenthesizedValue) = (function () {});
(castValue as any) = (() => {}) as any;
(ownName) = function own() {};
console.log(namesOf(parenthesizedValue, castValue, ownName));

const holder: any = {};
holder.member = function () {};
(holder.parenthesized) = function () {};
(holder.cast as any) = () => {};
holder["computed"] = class {};
[holder.element = function () {}] = [] as any[];
console.log(namesOf(holder.member, holder.parenthesized, holder.cast, holder.computed, holder.element));
