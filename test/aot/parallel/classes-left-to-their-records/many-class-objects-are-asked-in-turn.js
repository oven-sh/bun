const classes = [];
for (const make of [
  () => class C0 { static tag() { return 0; } }, () => class C1 { static tag() { return 1; } }, () => class C2 { static tag() { return 2; } }, () => class C3 { static tag() { return 3; } },
  () => class C4 { static tag() { return 4; } }, () => class C5 { static tag() { return 5; } }, () => class C6 { static tag() { return 6; } }, () => class C7 { static tag() { return 7; } },
  () => class C8 { static tag() { return 8; } }, () => class C9 { static tag() { return 9; } }, () => class C10 { static tag() { return 10; } }, () => class C11 { static tag() { return 11; } },
  () => class C12 { static tag() { return 12; } }, () => class C13 { static tag() { return 13; } }, () => class C14 { static tag() { return 14; } }, () => class C15 { static tag() { return 15; } },
  () => class C16 { static tag() { return 16; } }, () => class C17 { static tag() { return 17; } }, () => class C18 { static tag() { return 18; } }, () => class C19 { static tag() { return 19; } },
]) classes.push(make());
function plain() {}
let text = "";
for (let turn = 0; turn < 3; turn++) {
  for (let i = 0; i < classes.length; i++) {
    const c = classes[(i * 7 + turn) % classes.length];
    text += c.name + ":" + Object.getOwnPropertyNames(c).join("+") + ":" + c.tag() + ":" + (c.prototype.constructor === c) + ":" + Object.getOwnPropertyNames(plain).length + " ";
  }
}
console.log(text);
