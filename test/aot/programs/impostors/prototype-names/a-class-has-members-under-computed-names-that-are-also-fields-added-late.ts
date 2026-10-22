// The class body itself has members under computed names: a method, a getter with a setter, and a setter alone. The names are known only at run time,
// and they are the names of fields that typed code adds to the instances late, through a cast. The prototype has them before the first instance exists.
const log: string[] = [];
const names: string[] = JSON.parse('["target","type","flags"]');
interface LinksShape {
  _brand: any;
  target?: () => string;
  type?: number;
  flags?: number;
  free?: number;
}
const Links = class implements LinksShape {
  declare _brand: any;
  [names[0]]() {
    return "the method";
  }
  get [names[1]]() {
    return 41;
  }
  set [names[1]](value: number) {
    log.push("type = " + value);
  }
  set [names[2]](value: number) {
    log.push("flags = " + value);
  }
};
function make(flags: number): LinksShape {
  const links = new Links() as LinksShape;
  links.flags = flags;
  return links;
}
function typeOf(links: LinksShape) {
  if (links.type === undefined) links.type = 1;
  return links.type;
}
function setType(links: LinksShape, value: number) {
  links.type = value;
}
function call(links: LinksShape) {
  return links.target?.();
}
function state(links: LinksShape) {
  return `${call(links)} ${links.type} ${links.flags} ${links.free} [${Object.keys(links)}]`;
}

const first = make(1);
console.log("the first instance:", state(first), "|", log.join(", "));
log.length = 0;
let sum = 0;
for (let i = 0; i < 3000; i++) {
  const links = make(i & 3);
  sum += typeOf(links) + (links.flags ?? 5) + (links.free ?? 7) + call(links)!.length;
  if (i & 1) links.free = 1;
  if (i === 2999) setType(links, 9);
  sum += links.free ?? 7;
}
console.log("many", sum, log.length, log[log.length - 1]);
log.length = 0;
first.target = () => "an own function";
setType(first, 2);
console.log("stored:", state(first), "|", log.join(", "));
for (const name of names) delete (Links.prototype as any)[name];
const late = make(3);
console.log("all three deleted:", state(first), "|", state(late), "|", typeOf(late), state(late));
