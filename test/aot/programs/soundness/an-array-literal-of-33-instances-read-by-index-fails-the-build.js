class A { x = 1; }
const list = [new A(), new A(), new A(), new A(), new A(), new A(), new A(), new A(), new A(), new A(), new A(), new A(), new A(), new A(), new A(), new A(), new A(), new A(), new A(), new A(), new A(), new A(), new A(), new A(), new A(), new A(), new A(), new A(), new A(), new A(), new A(), new A(), new A()];
let sum = 0;
for (let i = 0; i < 33; ++i) sum += list[i].x;
console.log(sum);
