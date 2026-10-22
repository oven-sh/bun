// `restore = before` stands where the checker has narrowed `before` to the two strings that `restore` may hold, through a condition that was kept in a constant. Only the read of `before` says so: for the checker the
// types fit, so nothing is asked at the store.
// `restore` is captured by a closure, `kept` is a field, `pick` returns, `take` is called: each is a declared position of the narrower union, and each has to get a value that is proven to lie inside it.
type Mode = "off" | "read" | "write" | "admin";
type Restorable = "read" | "write";
class Holder {
  kept: Restorable = "read";
}
function take(mode: Restorable): number {
  return mode === "read" ? 1 : 2;
}
function pick(before: Mode): Restorable {
  const fits = before === "read" || before === "write";
  if (!fits) return "read";
  return before;
}
function run(before: Mode, ok: boolean, holder: Holder): string {
  let restore: Restorable = "read";
  const later = () => restore;
  let taken = 0;
  const liftable = before === "read" || before === "write";
  if (before === "off") {
    taken = -1;
  } else if (!liftable) {
    taken = -2;
  } else {
    if (ok) {
      restore = before;
      holder.kept = before;
      taken = take(before);
    }
  }
  return later() + " " + holder.kept + " " + taken + " " + pick(before);
}
const modes: Mode[] = ["off", "read", "write", "admin"];
for (let i = 0; i < 16; i++) {
  const mode = JSON.parse(JSON.stringify(modes[i & 3])) as Mode;
  console.log(mode, run(mode, (i & 4) === 0, new Holder()));
}
console.log(run("other" as Mode, true, new Holder()));
