const holder = { none: null };
const tell = (label, error) => console.log(label + ": " + error.constructor.name + ": " + error.message);
// Naming `arguments` makes the text of the file a function of the five names.
tell("arguments", { constructor: { name: typeof arguments }, message: String(arguments.length) });
try { console.log(holder.none.x); } catch (error) { tell("wrapped read", error); }
try { console.log("a" in holder.none); } catch (error) { tell("wrapped key test", error); }
try { console.log(Object.keys(holder.none)); } catch (error) { tell("wrapped keys", error); }
module.exports = { done: true };
