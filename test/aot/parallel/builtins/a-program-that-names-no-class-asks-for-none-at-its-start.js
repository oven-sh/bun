// The start locks the built-in objects that are there. A class that the realm has not made yet is locked when the realm makes it, so the start asks nobody for it by name:
// not the global object for Map, Date or a typed array, and not Intl for its two formatters.
console.log("started");
