// `bun run` fills an enum by assignments. Under a name that Object.prototype has, an assignment is refused once the program has frozen Object.prototype: in sloppy code it is dropped.
Object.freeze(Object.prototype);
enum Kind { toString, valueOf, plain }
enum Text { constructor = "c", hasOwnProperty = "h", plain = "p" }
console.log(Object.keys(Kind).join(), typeof Kind.toString, Kind[1], Kind.plain);
console.log(Object.keys(Text).join(), typeof Text.constructor, Text.plain);
