// Functions get a displayName through a proxy around the object that holds them. Frames are read before and after something looks at `name`.
const frame = stack => stack.split("\n")[1].trim().split(" ").slice(0, 2).join(" ");
const f = () => new Error("x").stack;
new Proxy({ f }, {}).f.displayName = "d";
void f.name;
console.log(frame(f()));
const g = async () => new Error("x").stack;
new Proxy({ g }, {}).g.displayName = "e";
console.log(frame(await g()));
void g.name;
console.log(frame(await g()));
