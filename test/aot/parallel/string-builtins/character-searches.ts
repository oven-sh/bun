// indexOf and lastIndexOf of one character at every place of strings of 0 to 300 characters, narrow and wide, from every kind of position.
const fillers = ["a", "þ", "一"];
const soughts = ["/", "ÿ", "Ā", "子", "a"];
let digest = 0;
const add = (value: number) => {
  digest = (Math.imul(digest, 31) + (value | 0)) | 0;
};
function slash(list: string[], from: number): void {
  for (const text of list) {
    add(text.indexOf("/"));
    add(text.lastIndexOf("/"));
    add(text.indexOf("/", from));
    add(text.lastIndexOf("/", from));
    add(text.indexOf("ÿ", from));
    add(text.lastIndexOf("ÿ", from));
    add(text.indexOf("Ā"));
    add(text.lastIndexOf("子"));
    add(text.includes("/") ? 1 : 0);
  }
}
function sought(list: string[], what: string, from: number): void {
  for (const text of list) {
    add(text.indexOf(what));
    add(text.lastIndexOf(what));
    add(text.indexOf(what, from));
    add(text.lastIndexOf(what, from));
  }
}
const lengths = [0, 1, 2, 7, 8, 9, 14, 15, 16, 17, 18, 30, 31, 32, 33, 47, 48, 49, 63, 64, 65, 127, 128, 129, 143, 144, 145, 160, 255, 256, 300];
for (const filler of fillers) {
  for (const length of lengths) {
    const list: string[] = [filler.repeat(length)];
    for (let place = 0; place < length; place += place < 40 ? 1 : 7) {
      for (const what of soughts) {
        const text = filler.repeat(place) + what + filler.repeat(length - place - 1);
        list.push(text, ("(" + text + ")").slice(1, -1));
      }
      list.push(filler.repeat(place >> 1) + "/" + filler.repeat(place - (place >> 1)) + "/" + filler.repeat(length - place - 1));
    }
    for (const from of [-1, 0, 1, 3, 15, 16, 17, 33, 64, 1000]) {
      slash(list, from);
      for (const what of soughts) sought(list, what, from);
    }
    console.log(JSON.stringify(filler), length, list.length, digest);
  }
}
