// A class in a file without types: a constructor's parameter fills the field, so nothing is written of it; what the class's own methods do with `this.<name>` gives the field a word, as a parameter's uses give the parameter one. The word is expected alone: every read is guarded at the run. The data comes out of a text. `s += this.items[i]` says a list of numbers; bytes, a buffer, floats and lists come in turn: each has its copy of the loop.
class Box { constructor(items) { this.items = items; } sum() { let s = 0; for (let i = 0; i < this.items.length; i++) s += this.items[i]; return s; } }
const name = JSON.parse('"sum"');
const out = text => JSON.parse(text);
for (let turn = 0; turn < 2; turn++) for (const items of [new Uint8Array([3, 4, 5]), Buffer.from([1, 2]), new Float64Array([0.5, 0.25]), out('[0.5,1.5]'), out('[1,2,3]'), out('["a",1]'), out('[]')]) console.log(new Box(items)[name]());
