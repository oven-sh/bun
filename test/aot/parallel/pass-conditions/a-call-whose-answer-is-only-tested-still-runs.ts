const seen: string[] = [];
const hooks: Record<string, () => unknown> = {
  first: () => seen.push("first"),
  second: () => {
    seen.push("second");
    return 0;
  },
};
function ask(name: string): void {
  if (hooks[name]()) {
  }
}
function askTwice(name: string): void {
  hooks[name]() ? undefined : undefined;
  if (hooks[name]() === 1) {
  } else {
  }
}
const names = Object.keys(hooks);
ask(names[seen.length]);
ask(names[seen.length]);
askTwice(names[seen.length - 2]);
console.log(seen.join(" "));
