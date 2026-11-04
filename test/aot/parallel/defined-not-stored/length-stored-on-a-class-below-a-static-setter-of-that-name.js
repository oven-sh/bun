class Above { static set length(value) { console.log("the setter ran"); } }
class Below extends Above {}
try { Below.length = 7; console.log("stored"); } catch (error) { console.log(error.constructor.name); }
console.log(Below.length);
