const holder = { none: null };
const tell = (label, error) => console.log(label + ": " + error.constructor.name + ": " + error.message);
try { console.log(holder.none.x); } catch (error) { tell("required read", error); }
try { console.log("a" in holder.none); } catch (error) { tell("required key test", error); }
try { console.log(Object.keys(holder.none)); } catch (error) { tell("required keys", error); }
exports.done = true;
