// Keys of 15 to 48 characters that begin and end alike and differ only in the middle, in one place of a text and in the same order, so that each must be told from the one expected there.
function show(label: string, text: string) {
  for (let turn = 0; turn < 3; turn++) {
    const value = JSON.parse(text) as Record<string, unknown>;
    console.log(label, turn, Object.keys(value).join(), JSON.stringify(value) === text);
  }
}
for (const length of [15, 16, 17, 18, 23, 24, 25, 32, 33, 40, 47, 48]) {
  const name = (middle: string) => "beginning" .slice(0, 7) + middle.repeat(length - 14) + "theends";
  show("length " + length + ", the first", '{"lead":1,"' + name("a") + '":1,"tail":2}');
  show("length " + length + ", another middle", '{"lead":1,"' + name("b") + '":1,"tail":2}');
  show("length " + length + ", one character more", '{"lead":1,"' + name("a") + 'x":1,"tail":2}');
  show("length " + length + ", both", '{"lead":1,"' + name("a") + '":1,"' + name("b") + '":2,"tail":3}');
  show("length " + length + ", the first again", '{"lead":1,"' + name("a") + '":1,"tail":2}');
}
