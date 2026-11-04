class Above { static set name(value) { console.log("the setter ran"); } }
class Below extends Above {}
try { Below.name = "stored"; console.log("stored"); } catch (error) { console.log(error.constructor.name); }
console.log(Below.name);
