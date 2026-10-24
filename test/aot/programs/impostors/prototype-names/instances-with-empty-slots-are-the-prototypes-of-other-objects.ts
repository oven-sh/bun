// An instance of the class is itself the prototype of other objects, made by Object.create and by a second class whose prototype is hung under it.
// A read that starts at the heir passes the instance's empty slot and goes on to the class's prototype; filling the slot of the instance changes what the heirs see.
const log: string[] = [];
class Theme {
  declare name: string;
  declare accent?: string;
  constructor(name: string) {
    this.name = name;
  }
}
function accentOf(theme: Theme) {
  return theme.accent;
}
function setAccent(theme: Theme, value: string) {
  theme.accent = value;
}
function state(theme: Theme) {
  return `${accentOf(theme)} ${"accent" in theme} ${Object.hasOwn(theme, "accent")}`;
}

let length = 0;
for (let i = 0; i < 3000; i++) {
  const theme = new Theme("t");
  length += accentOf(theme)?.length ?? 1;
  if (i & 1) setAccent(theme, "red");
  length += accentOf(theme)?.length ?? 1;
}
console.log("warm", length);

const parent = new Theme("parent");
const heir: Theme = Object.create(parent);
const heirOfHeir: Theme = Object.create(heir);
const all = () => [parent, heir, heirOfHeir].map(state).join(" | ");
console.log("nothing anywhere:", all());
(Theme.prototype as any)["acc" + "ent"] = "of the class";
console.log("on the class's prototype:", all());
setAccent(parent, "of the parent");
console.log("the parent's slot is filled:", all());
setAccent(heirOfHeir, "of the last heir");
console.log("the last heir has its own:", all(), Object.keys(heirOfHeir).join());
delete parent.accent;
console.log("the parent's slot is emptied:", all());
Object.defineProperty(Theme.prototype, "accent", {
  set(this: Theme, value: string) {
    log.push(`set ${value}, this is the heir: ${this === heir}`);
  },
  configurable: true,
});
setAccent(heir, "through two levels");
console.log("a setter on the class's prototype:", all(), "|", log.join(", "));
delete (Theme.prototype as any).accent;
setAccent(heir, "own");
console.log("gone again:", all(), Object.keys(heir).join());

class Skin {
  declare shade?: string;
  declare accent?: string;
}
function shadeAndAccent(skin: Skin) {
  return `${skin.shade} ${skin.accent} ${(skin as unknown as Theme).name}`;
}
for (let i = 0; i < 3000; i++) length += shadeAndAccent(new Skin()).length;
console.log("warm", length);
const model = new Theme("model");
Object.setPrototypeOf(Skin.prototype, model);
const skin = new Skin();
console.log("a class under an instance:", shadeAndAccent(skin));
setAccent(model, "of the model");
(model as any).shade = "shade on the model";
console.log("the instance is filled:", shadeAndAccent(skin), shadeAndAccent(new Skin()), Object.keys(skin).length);
skin.shade = "own";
delete (model as any).shade;
console.log("and emptied:", shadeAndAccent(skin), shadeAndAccent(new Skin()));
