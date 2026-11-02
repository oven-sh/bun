import { clear, type Box } from "ships-typescript";
const box: Box = { value: 3, size: 5 };
console.log(clear(box), "value" in box, box.value, Object.keys(box).join());
