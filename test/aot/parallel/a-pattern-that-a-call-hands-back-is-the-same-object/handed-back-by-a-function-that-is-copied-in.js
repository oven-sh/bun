// A function that gives its argument back gives back the same object, whoever asks first.
const id = v => v;
const v = /r/;
console.log(Object.is(id(v), v));

function declared(value) { return value; }
const second = /r/;
console.log(Object.is(declared(second), second));

const holder = { method(value) { return value; } };
const third = new RegExp("r");
console.log(Object.is(holder.method(third), third));

const fourth = /r/;
const again = id(fourth);
console.log(Object.is(again, fourth));

const pick = (condition, one, other) => condition ? one : other;
const fifth = /r/, sixth = /r/;
console.log(Object.is(pick(true, fifth, sixth), fifth), Object.is(pick(false, fifth, sixth), sixth), Object.is(pick(true, fifth, sixth), sixth));

const seventh = /r/;
console.log(Array.isArray(id(seventh)), Object.is(id(seventh), seventh), Object.is(/r/, /r/));
