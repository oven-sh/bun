// `new String(undefined)` holds "undefined", and its length is read off it.
function ofUndefined() { return new String(undefined).length; }
function ofNothing(x) { var made = new String(x ? undefined : void 0); return made.length; }
function ofMaybe(x) { return new String(x ? undefined : "ab").length; }
function ofNull() { return new String(null).length; }
console.log(ofUndefined(), ofNothing(1), ofMaybe(1), ofMaybe(0), ofNull(), new String().length, new String(undefined, 1).length, new String(undefined) + "!", new String(void 0) == "undefined");
for (let i = 0; i < 3; i++) console.log(new String(undefined).length + i, new String([][0]).length);
