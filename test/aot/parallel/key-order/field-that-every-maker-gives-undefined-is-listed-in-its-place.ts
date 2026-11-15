// Every maker gives a field undefined, only to give the objects one shape. The property is there all the same: it is listed in its place, found, described, copied, and takes a value later.
interface Links {
  seen?: boolean;
}
interface WideLinks extends Links {
  wide: number | undefined;
  deep: number | undefined;
}
class Made implements Links {}
function make(): WideLinks {
  const made = new Made() as WideLinks;
  made.wide = undefined;
  made.deep = 4;
  return made;
}
function deed(made: WideLinks) {
  return [Object.keys(made).join(), "wide" in made, Object.hasOwn(made, "wide"), JSON.stringify(made), Object.keys({ ...made }).join(), String(made.wide)].join(" ");
}
console.log(deed(make()));
const later = make();
later.wide = 7;
console.log(deed(later));
later.wide = undefined;
console.log(deed(later));
delete (later as any).wide;
console.log(deed(later));
later.wide = undefined;
console.log(deed(later));
let last = "";
for (let i = 0; i < 300; i++) {
  const made = make();
  if (i % 2) made.wide = i;
  last = deed(made);
}
console.log(last);
