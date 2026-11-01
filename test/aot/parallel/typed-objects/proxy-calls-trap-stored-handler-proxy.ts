// A proxy reads a trap off its handler at every access, so it calls a trap that is stored on the handler, or above it, after the proxy was made. The handlers are instances of classes that declare no member.
const constructible: any = new Proxy(function () {}, { get: () => 1 });
const built: any = new constructible();
console.log(built.size);

class Bare {}

function readColor(): string {
  const handler: any = new (class {})();
  const paint: any = new Proxy({ color: "blue" }, handler);
  const before = paint.color;
  handler.get = () => "red";
  return before + " " + paint.color;
}

function hasColor(): string {
  const handler: any = new (class {})();
  const paint: any = new Proxy({}, handler);
  const before = "color" in paint;
  handler.has = () => true;
  return before + " " + ("color" in paint);
}

function storeColor(): string {
  const handler: any = new (class {})();
  const target: any = {};
  const paint: any = new Proxy(target, handler);
  paint.color = "blue";
  const before = target.color;
  handler.set = (held: any, key: string, value: string) => {
    held[key] = value + "!";
    return true;
  };
  paint.color = "red";
  return before + " " + target.color;
}

function deleteColor(): string {
  const handler: any = new (class {})();
  const target: any = { color: "red", shade: "dark" };
  const paint: any = new Proxy(target, handler);
  const before = delete paint.shade;
  handler.deleteProperty = () => true;
  return before + " " + target.shade + " " + delete paint.color + " " + target.color;
}

function ownsColor(): string {
  const handler: any = new (class {})();
  const paint: any = new Proxy({}, handler);
  const before = Object.hasOwn(paint, "color");
  handler.getOwnPropertyDescriptor = () => ({ value: 1, configurable: true });
  return before + " " + Object.hasOwn(paint, "color");
}

function readBelowClass(): string {
  const handler: any = new Bare();
  const paint: any = new Proxy({ color: "blue" }, handler);
  const said = [paint.color];
  (Bare.prototype as any).get = () => "from the class";
  said.push(paint.color);
  handler.get = () => "red";
  said.push(paint.color);
  delete handler.get;
  said.push(paint.color);
  delete (Bare.prototype as any).get;
  said.push(paint.color);
  return said.join(", ");
}

for (let round = 0; round < 2; round++) {
  console.log(readColor());
  console.log(hasColor());
  console.log(storeColor());
  console.log(deleteColor());
  console.log(ownsColor());
  console.log(readBelowClass());
}
