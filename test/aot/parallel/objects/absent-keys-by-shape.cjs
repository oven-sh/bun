// Keys that are joined are absent on an object by their lengths and first units alone, though each is the name of something else.
// COUNT: operationAOTGetByValAndCache <= 4
const known = { "Declaration-color": 1, "Declaration-top": 2, "Declaration-float": 3, "DeclarationExit-color": 4, "DeclarationExit-float": 5, "AtRule-media": 6, "AtRuleExit-media": 7, "AtRuleExit-supports": 8, "Declaration-border": 9, "Declaration-margin-left": 10 };
const listeners = {};
for (const event of ["OnceExit", "Rule", "Once"]) listeners[event] = event.length;
const listed = [];
function read(object, first, second, third) {
    listed[0] = first + second + third;
    let value;
    for (const event of listed) value = object[event];
    return value;
}
let found = 0, absent = 0;
for (let round = 0; round < 4; ++round) {
    for (const name of Object.keys(known)) {
        const [first, second] = name.split("-");
        read(listeners, first, "-", name.slice(first.length + 1)) === undefined ? ++absent : ++found;
    }
}
console.log(found, absent, read(listeners, "On", "ce", "Exit"), read(listeners, "On", "ce", ""), read(listeners, "has", "Own", "Property") === Object.prototype.hasOwnProperty, known["AtRule-media"]);
