class Above { static name() { return "called"; } }
class Below extends Above {}
try { console.log(Below.name()); } catch (error) { console.log(error.constructor.name); }
console.log(Above.name());
