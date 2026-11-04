class Above { static length() { return "called"; } }
class Below extends Above {}
try { console.log(Below.length()); } catch (error) { console.log(error.constructor.name); }
console.log(Above.length());
