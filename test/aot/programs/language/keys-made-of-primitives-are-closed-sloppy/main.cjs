// In sloppy code a store to a locked prototype under a key that the language makes of a value that is no string throws a TypeError, as in strict code. An ordinary new name is stored. language/keys-made-of-primitives-are-closed has the strict stores.
function store(object, key) {
  try { object[key] = "added"; } catch (e) { return e.name; }
  var stored = object[key] === "added";
  delete object[key];
  return stored ? "stored" : "ignored";
}
var keys = [undefined, null, true, false, NaN, -1, 1.5, 0, "nothing"];
function row(name, object) {
  var line = name + ":";
  for (var i = 0; i < keys.length; i++) line += " " + String(keys[i]) + " " + store(object, keys[i]);
  console.log(line);
}
row("Array.prototype", Array.prototype);
row("String.prototype", String.prototype);
row("Date.prototype", Date.prototype);
row("WeakRef.prototype", WeakRef.prototype);
