class Above { static length = "a text"; }
class Below extends Above { constructor(first) { super(); } }
console.log(Below.length + 1, typeof Below.length, Above.length + 1);
