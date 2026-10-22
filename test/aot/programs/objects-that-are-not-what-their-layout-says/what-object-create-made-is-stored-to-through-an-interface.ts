interface Box { value: number; label?: string }
const box = Object.create(null) as Box;
box.value = 3;
box.label = "three";
const plain: Box = { value: 4 };
function grow(b: Box): number { b.value += 1; return b.value; }
console.log(grow(box), grow(plain), box.label, Object.keys(box).join(), "label" in plain);
