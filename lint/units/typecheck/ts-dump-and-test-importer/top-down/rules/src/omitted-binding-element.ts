const [, a, , b] = [1, 2, 3, 4];
const [c = 1, ...d] = [];
function f([, x]: number[], { y, z: [, w] }: any) {}
const arr = [, 1, , 2];
