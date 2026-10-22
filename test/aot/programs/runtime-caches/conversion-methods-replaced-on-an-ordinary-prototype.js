// The engine remembers, with the Structure of an object, which valueOf, toString and toJSON its prototype gives it, and asks to hear of it when another value takes their place there.
// The stores that replace them are ordinary stores by name to an ordinary object, which has been stored to many times before anybody asked to hear of anything.
const hide = (0, eval)("(value) => value");
const lines = [];
function replace(target, which, value) {
    if (which === 0) target.valueOf = value;
    else if (which === 1) target.toString = value;
    else if (which === 2) target.toJSON = value;
    else target.plain = value;
}
function convert(object) {
    return [+object, `${object}`, JSON.stringify(object), object.plain].join(" ");
}
// The object's own names, read from the object itself.
function own(object) {
    return [typeof object.valueOf, typeof object.toString, typeof object.toJSON, object.plain, object.absent, Object.keys(object).join()].join(" ");
}
function family(label) {
    // No literal of the program: an object that the run time makes.
    const above = JSON.parse('{"valueOf":0,"toString":0,"toJSON":0,"plain":0}');
    const below = [];
    for (let i = 0; i < 4; i++) below.push(Object.create(above));
    return { above, below };
}
for (const label of ["a", "b", "c"]) {
    const { above, below } = family(label);
    // Stores before anybody has converted anything.
    for (let round = 0; round < 40; round++) {
        for (let which = 0; which < 4; which++) {
            const number = round * 4 + which;
            replace(hide(above), which, which === 0 ? () => number : which === 3 ? number : () => label + number);
        }
    }
    lines.push(label + " before: " + below.map(convert).join(" | "));
    // Conversions, over and over: now it is remembered.
    let sum = 0;
    for (let round = 0; round < 200; round++) {
        for (const object of below) sum += +object + `${object}`.length + JSON.stringify(object).length;
    }
    lines.push(label + " sum: " + sum);
    lines.push(label + " own: " + own(hide(above)) + " | " + own(hide(below[0])));
    // And each is replaced again, the same way.
    for (let round = 0; round < 6; round++) {
        for (let which = 0; which < 4; which++) {
            const number = 1000 + round * 4 + which;
            replace(hide(above), which, which === 0 ? () => number : which === 3 ? number : () => label + number);
            lines.push(label + " " + round + "." + which + ": " + below.map(convert).join(" | ") + " own: " + own(hide(above)));
        }
        for (let again = 0; again < 50; again++) {
            for (const object of below) sum += +object + `${object}`.length + JSON.stringify(object).length;
        }
    }
    lines.push(label + " sum: " + sum);
}
console.log(lines.join("\n"));
