// An enum member whose initializer reads an enum of another file is evaluated where the enum is created, as in plain Bun: a string gets a reverse key, and the next member has no implicit value.
import { Color, Size } from "./shared";
function row(label: string, value: object) {
  console.log(label + ": " + Object.keys(value).map(key => key + "=" + String((value as any)[key])).join());
}

enum ColorAlias { R = Color.Red }
row("a string member", ColorAlias);
enum SizeAlias { S = Size.Small, Next }
row("a number member", SizeAlias);
enum Joined { A = Color.Red + "-a", B = `${Color.Red}`, C = Size.Small + 1 }
row("in a larger initializer", Joined);

(Color as any).Red = "stored";
enum AfterStore { R = Color.Red }
row("after a store to the member", AfterStore);
