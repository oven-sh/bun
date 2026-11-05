enum Dense { A, B, C, D, E, F, G, H }
enum Flags { None = 0, One = 1 << 0, Two = 1 << 1, Ten = 1 << 10, Twenty = 1 << 20, Thirty = 1 << 30, Top = 1 << 31 }
enum Odd { Minus = -1, Half = 0.5, Big = 4294967294, Bigger = 4294967295, Huge = 1e21, Zero = 0, MinusZero = -0 }
enum Twice { First = 1, Second = 1, Third = 2, Fourth = 1 }
enum Mixed { Text = "text", Number = 7, Other = "7", After = 8 }
enum Far { Near = 1, Away = 100000, Further = 5000000, Back = 2 }
function show(name: string, object: object) {
  console.log(name, Object.keys(object).join(","));
  console.log(name, JSON.stringify(object));
  console.log(name, Object.entries(Object.getOwnPropertyDescriptors(object)).map(([key, descriptor]) => `${key}:${descriptor.writable}${descriptor.enumerable}${descriptor.configurable}`).join(" "));
}
show("Dense", Dense);
show("Flags", Flags);
show("Odd", Odd);
show("Twice", Twice);
show("Mixed", Mixed);
show("Far", Far);
console.log(Dense[3], Flags[1024], Flags[-2147483648], Odd[-1], Odd[0.5], Odd[4294967294], Odd[4294967295], Odd[0], Twice[1], Mixed[7], Far[5000000]);
const dense: Record<string | number, unknown> = Dense;
dense[100] = "added";
delete dense[2];
Object.freeze(dense);
show("Dense, changed and frozen", Dense);
