const list = [1, 2];
class P { constructor(x, y) { list.push(x + y); list[0] = 9; this.t = x + "," + y + "," + arguments.length; } }
console.log(Reflect.construct(P, list).t, list.join(), Reflect.construct(P, list).t, list.join());
