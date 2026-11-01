// Exit code: 1
declare const KEY: "k";
class Base {}
Object.defineProperty(Base.prototype, "y", { set(v: number) { console.log("setter ran"); } });
class D extends Base { [KEY] = 1; y = 2; }
console.log(Object.keys(new D()).join("+"));
// bun build --compile --define KEY='"k"' (base8): setter ran, k . with --aot: k+y
