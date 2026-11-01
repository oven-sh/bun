// new Set(a list) whose texts the program has put together: by +, by a template, by slice(). They are the keys that the same texts written out are, beside texts that are written out, numbers and undefined,
// in lists of up to eight and of more.
// Flags: --aot-validate
const words: string[] = (process.env.NO_SUCH_NAME ?? "alpha beta gamma delta epsilon zeta").split(" ");
const many: string[] = Array.from({ length: 40 }, (_, i) => "w" + (i % 30));
const show = (set: Set<unknown>) => [...set].join(",") + " " + set.size;
console.log(show(new Set(words.map(word => word + 1))));
console.log(show(new Set(words.map(word => `${word}-${word}`))));
console.log(show(new Set(many.map(word => word + "x"))));
console.log(show(new Set([...words, ...words.map(word => word + ""), words[0] + words[1]])));
console.log(show(new Set([words[0] + "a", 1, words[1] + "b"])));
console.log(show(new Set([words[0] + "a", undefined, words[0] + "a"])));
console.log(show(new Set(many.map((word, i) => (i % 2 ? word + "y" : word)))));
console.log(show(new Set(words.map(word => (word + word).slice(1, 4)))));
