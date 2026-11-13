// A joined key whose length is that of no name on the object and above it is answered without a call of the run time.
// COUNT: operationAOTGetByValGeneric <= 40
const listeners = {}, bare = Object.create(null);
for (const event of ["OnceExit", "Rule", "Once"]) { listeners[event] = event.length; bare[event] = 1; }
const listed = [];
function read(object, first, second) {
    listed[0] = first + second;
    let value;
    for (const event of listed) value = object[event];
    return value;
}
let absent = 0, found = 0;
for (let i = 0; i < 90; ++i) {
    if (read(listeners, "Declaration-col", "or" + (i + 10)) === undefined) ++absent;
    if (i % 30 === 0 && read(bare, "Declaration-", "float" + i) === undefined) ++absent;
    if (i % 30 === 0) found += read(listeners, "Once", "Exit") + read(listeners, "Ru", "le") + (read(listeners, "propertyIs", "Enumerable") === Object.prototype.propertyIsEnumerable ? 1 : 0);
}
listeners["late-declaration-color77"] = "late";
console.log(absent, found, read(listeners, "late-declaration-col", "or77"), read(listeners, "late-declaration-col", "or88"));
