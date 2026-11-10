// Under: --aot-check=Validate: a definition on a class object hides a static getter: a lookup through it may not still be said to find the getter
const mark = Symbol("mark");
class Kind { static get [mark]() { return 1; } static get plain() { return 1; } }
class Answers { constructor(given) { return given; } }
class Stamp extends Answers { plain = 2; }
new Stamp(Kind);
function read(holder) { return holder.plain; }
console.log(read(Kind));
