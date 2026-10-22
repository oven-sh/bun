interface Box { value: number; label?: string }
let seen = "";
const box = Object.create({ set label(text: string) { seen += text; } }) as Box;
const literal: Box = { value: 9 };
function fill(): void { box.value = 3; box.label = "three"; delete (box as { value?: number }).value; box.value = 4; }
fill();
console.log(box.value, seen, Object.keys(box).join(), literal.value, box.label);
