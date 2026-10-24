// URL's href, a host getter, read by name on instances of compiled subclasses. The cached answer passes the class prototypes, and whatever shadows the getter later wins.
const lines = [];
const show = (label, value) => lines.push(label + ": " + String(value));

const readHref = o => o.href;
const key = JSON.parse('"href"');
const readByKey = o => o[key];

function readRepeatedly(receiver, read = readHref) {
  let last;
  for (let i = 0; i < 1000; i++) last = read(receiver);
  return last;
}

function errorOf(action) {
  try {
    return "no error: " + String(action());
  } catch (error) {
    return error.name;
  }
}

class Link extends URL {
  describe() {
    return "link to " + this.host;
  }
}
class DeepLink extends Link {}
class LinkWithGetter extends Link {
  get href() {
    return "declared getter over " + super.href;
  }
}
class LinkWithMethod extends Link {
  href() {
    return "declared method";
  }
}

const link = new Link("https://example.com/link");
const deep = new DeepLink("https://example.com/deep");
show("one class below URL", readRepeatedly(link));
show("two classes below URL", readRepeatedly(deep));
show("by key", readRepeatedly(deep, readByKey));
show("declared getter", readRepeatedly(new LinkWithGetter("https://example.com/getter")));
show("declared method", readRepeatedly(new LinkWithMethod("https://example.com/method"))());
show("receiver that is not a URL", errorOf(() => readRepeatedly(Object.create(Link.prototype))));

link.hash = "#changed";
show("after the URL changed", readRepeatedly(link));

const shadowed = new Link("https://example.com/shadowed");
show("before the own property", readRepeatedly(shadowed));
Object.defineProperty(shadowed, "href", { value: "own value", configurable: true });
show("own property", readRepeatedly(shadowed));
delete shadowed.href;
show("own property deleted", readRepeatedly(shadowed));

show("a declared method is called", deep.describe());
show("after the method call", readRepeatedly(deep));

Object.defineProperty(DeepLink.prototype, "href", { get() { return "getter added to DeepLink.prototype"; }, configurable: true });
show("getter added to the nearer prototype", readRepeatedly(deep));
show("the other class", readRepeatedly(link));
delete DeepLink.prototype.href;
show("getter deleted", readRepeatedly(deep));

Object.defineProperty(Link.prototype, "href", { value: "value added to Link.prototype", configurable: true });
show("value added to the farther prototype", readRepeatedly(deep) + ", " + readRepeatedly(link));
delete Link.prototype.href;
show("value deleted", readRepeatedly(deep) + ", " + readRepeatedly(link));

Object.setPrototypeOf(DeepLink.prototype, { href: "value of the new prototype" });
show("prototype of DeepLink.prototype replaced", readRepeatedly(deep));
show("the other class after the replacement", readRepeatedly(link));

console.log(lines.join("\n"));
