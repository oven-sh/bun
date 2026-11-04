class Above { static set length(value) { console.log("the setter ran"); } }
class Below extends Above { constructor(first, second) { super(); } }
console.log(Below.length, Above.length, Object.hasOwn(Below, "length"));
