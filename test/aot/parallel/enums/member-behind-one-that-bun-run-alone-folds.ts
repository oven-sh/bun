// @ts-nocheck
// `bun run` puts a number in place of each of these initializers, so the member behind it counts on from that number. An executable leaves them to the run time, with `--aot` and without, and the member behind has no value.
// Reference: bun build --compile
function show(name: string, seen: any, byName: unknown[]) {
  console.log(name, "by name", byName.map(String).join(" "), "by key", String(seen["First"]), String(seen["Next"]), String(seen["Last"]), "keys", Object.keys(seen).join("+"));
}
enum E1 { First = "a".length, Next, Last = Next + 1 }
show("E1", E1, [E1.First, E1.Next, E1.Last]);
enum E2 { First = "a".length as any, Next, Last = Next + 1 }
show("E2", E2, [E2.First, E2.Next, E2.Last]);
enum E3 { First = "ab".length + 1, Next, Last = Next + 1 }
show("E3", E3, [E3.First, E3.Next, E3.Last]);
enum E4 { First = ("a").length, Next, Last = Next + 1 }
show("E4", E4, [E4.First, E4.Next, E4.Last]);
enum E5 { First = "a"["length"], Next, Last = Next + 1 }
show("E5", E5, [E5.First, E5.Next, E5.Last]);
enum E6 { First = `a`.length, Next, Last = Next + 1 }
show("E6", E6, [E6.First, E6.Next, E6.Last]);
enum E7 { First = "é".length, Next, Last = Next + 1 }
show("E7", E7, [E7.First, E7.Next, E7.Last]);
enum E8 { First = "a".length!, Next, Last = Next + 1 }
show("E8", E8, [E8.First, E8.Next, E8.Last]);
enum E9 { First = <any>"a".length, Next, Last = Next + 1 }
show("E9", E9, [E9.First, E9.Next, E9.Last]);
enum E10 { First = 1 + "a".length, Next, Last = Next + 1 }
show("E10", E10, [E10.First, E10.Next, E10.Last]);
enum E11 { First = -"a".length, Next, Last = Next + 1 }
show("E11", E11, [E11.First, E11.Next, E11.Last]);
enum E12 { First = "a".length * 2, Next, Last = Next + 1 }
show("E12", E12, [E12.First, E12.Next, E12.Last]);
enum E13 { First = "".length, Next, Last = Next + 1 }
show("E13", E13, [E13.First, E13.Next, E13.Last]);
enum E14 { First = "a".length satisfies number, Next, Last = Next + 1 }
show("E14", E14, [E14.First, E14.Next, E14.Last]);
enum E15 { First = ("a" + "b").length, Next, Last = Next + 1 }
show("E15", E15, [E15.First, E15.Next, E15.Last]);
enum E16 { First = "a".length ? 3 : 4, Next, Last = Next + 1 }
show("E16", E16, [E16.First, E16.Next, E16.Last]);
enum E17 { First = (1, 2), Next, Last = Next + 1 }
show("E17", E17, [E17.First, E17.Next, E17.Last]);
// These both fold, and so do we.
enum Cast { First = 1 as any, Next, Last = Next + 1 }
show("Cast", Cast, [Cast.First, Cast.Next, Cast.Last]);
enum Chosen { First = true ? 3 : 4, Next, Last = Next + 1 }
show("Chosen", Chosen, [Chosen.First, Chosen.Next, Chosen.Last]);
