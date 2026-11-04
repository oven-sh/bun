// @ts-nocheck
class Above {}
const seen = new Set<string>();
function watch(name: string) {
  if (seen.has(name)) return;
  seen.add(name);
  Object.defineProperty(Above.prototype, name, {
    set(value) {
      console.log("  set", name);
    },
    configurable: true,
  });
}
watch("y");
const keys = (o: object) => Reflect.ownKeys(o).map(String).join("+") || "none";
watch(String(0x0n || "x"));
class Field1 extends Above { [0x0n || "x"] = 1; y = 2; }
console.log(1, String.raw`0x0n || "x"`, keys(new Field1()));
watch(String(0x1n || "x"));
class Field2 extends Above { [0x1n || "x"] = 1; y = 2; }
console.log(2, String.raw`0x1n || "x"`, keys(new Field2()));
watch(String(0x1n && "x"));
class Field3 extends Above { [0x1n && "x"] = 1; y = 2; }
console.log(3, String.raw`0x1n && "x"`, keys(new Field3()));
watch(String(0x0n && "x"));
class Field4 extends Above { [0x0n && "x"] = 1; y = 2; }
console.log(4, String.raw`0x0n && "x"`, keys(new Field4()));
watch(String(0x0n || 5));
class Field5 extends Above { [0x0n || 5] = 1; y = 2; }
console.log(5, String.raw`0x0n || 5`, keys(new Field5()));
watch(String(0x1n && 0));
class Field6 extends Above { [0x1n && 0] = 1; y = 2; }
console.log(6, String.raw`0x1n && 0`, keys(new Field6()));
watch(String(0x1n && ""));
class Field7 extends Above { [0x1n && ""] = 1; y = 2; }
console.log(7, String.raw`0x1n && ""`, keys(new Field7()));
watch(String(!`é${1}` || "x"));
class Field8 extends Above { [!`é${1}` || "x"] = 1; y = 2; }
console.log(8, String.raw`!\`é\${1}\` || "x"`, keys(new Field8()));
watch(String(`é${1}` && "x"));
class Field9 extends Above { [`é${1}` && "x"] = 1; y = 2; }
console.log(9, String.raw`\`é\${1}\` && "x"`, keys(new Field9()));
watch(String(`é${1}` || "x"));
class Field10 extends Above { [`é${1}` || "x"] = 1; y = 2; }
console.log(10, String.raw`\`é\${1}\` || "x"`, keys(new Field10()));
watch(String(("é" + 1) && "x"));
class Field11 extends Above { [("é" + 1) && "x"] = 1; y = 2; }
console.log(11, String.raw`("é" + 1) && "x"`, keys(new Field11()));
watch(String(!("é" + 1) || "x"));
class Field12 extends Above { [!("é" + 1) || "x"] = 1; y = 2; }
console.log(12, String.raw`!("é" + 1) || "x"`, keys(new Field12()));
watch(String(0x0n || 0x0n || "x"));
class Field13 extends Above { [0x0n || 0x0n || "x"] = 1; y = 2; }
console.log(13, String.raw`0x0n || 0x0n || "x"`, keys(new Field13()));
watch(String(0x1n && 0x1n && "x"));
class Field14 extends Above { [0x1n && 0x1n && "x"] = 1; y = 2; }
console.log(14, String.raw`0x1n && 0x1n && "x"`, keys(new Field14()));
watch(String((0x0n || "x") + "y"));
class Field15 extends Above { [(0x0n || "x") + "y"] = 1; y = 2; }
console.log(15, String.raw`(0x0n || "x") + "y"`, keys(new Field15()));
watch(String(`${0x0n || "x"}`));
class Field16 extends Above { [`${0x0n || "x"}`] = 1; y = 2; }
console.log(16, String.raw`\`\${0x0n || "x"}\``, keys(new Field16()));
watch(String((0x0n || "x") ? "a" : "b"));
class Field17 extends Above { [(0x0n || "x") ? "a" : "b"] = 1; y = 2; }
console.log(17, String.raw`(0x0n || "x") ? "a" : "b"`, keys(new Field17()));
watch(String((0x1n && "") ? "a" : "b"));
class Field18 extends Above { [(0x1n && "") ? "a" : "b"] = 1; y = 2; }
console.log(18, String.raw`(0x1n && "") ? "a" : "b"`, keys(new Field18()));
watch(String((0x1n && "x") ? "a" : "b"));
class Field19 extends Above { [(0x1n && "x") ? "a" : "b"] = 1; y = 2; }
console.log(19, String.raw`(0x1n && "x") ? "a" : "b"`, keys(new Field19()));
watch(String(!(0x0n || "x") ? "a" : "b"));
class Field20 extends Above { [!(0x0n || "x") ? "a" : "b"] = 1; y = 2; }
console.log(20, String.raw`!(0x0n || "x") ? "a" : "b"`, keys(new Field20()));
watch(String((0x0n || "x") && "y"));
class Field21 extends Above { [(0x0n || "x") && "y"] = 1; y = 2; }
console.log(21, String.raw`(0x0n || "x") && "y"`, keys(new Field21()));
watch(String((0x0n || "x") || "y"));
class Field22 extends Above { [(0x0n || "x") || "y"] = 1; y = 2; }
console.log(22, String.raw`(0x0n || "x") || "y"`, keys(new Field22()));
watch(String((0x1n && "") || "y"));
class Field23 extends Above { [(0x1n && "") || "y"] = 1; y = 2; }
console.log(23, String.raw`(0x1n && "") || "y"`, keys(new Field23()));
watch(String((0x1n && "") && "y"));
class Field24 extends Above { [(0x1n && "") && "y"] = 1; y = 2; }
console.log(24, String.raw`(0x1n && "") && "y"`, keys(new Field24()));
watch(String(0n || "x"));
class Field25 extends Above { [0n || "x"] = 1; y = 2; }
console.log(25, String.raw`0n || "x"`, keys(new Field25()));
watch(String(1n && "x"));
class Field26 extends Above { [1n && "x"] = 1; y = 2; }
console.log(26, String.raw`1n && "x"`, keys(new Field26()));
watch(String(0 || "x"));
class Field27 extends Above { [0 || "x"] = 1; y = 2; }
console.log(27, String.raw`0 || "x"`, keys(new Field27()));
watch(String(1 && "x"));
class Field28 extends Above { [1 && "x"] = 1; y = 2; }
console.log(28, String.raw`1 && "x"`, keys(new Field28()));
watch(String("" || "x"));
class Field29 extends Above { ["" || "x"] = 1; y = 2; }
console.log(29, String.raw`"" || "x"`, keys(new Field29()));
watch(String(`a${1}` && "x"));
class Field30 extends Above { [`a${1}` && "x"] = 1; y = 2; }
console.log(30, String.raw`\`a\${1}\` && "x"`, keys(new Field30()));
watch(String(!`a${1}` || "x"));
class Field31 extends Above { [!`a${1}` || "x"] = 1; y = 2; }
console.log(31, String.raw`!\`a\${1}\` || "x"`, keys(new Field31()));
watch(String((0 || "x") + "y"));
class Field32 extends Above { [(0 || "x") + "y"] = 1; y = 2; }
console.log(32, String.raw`(0 || "x") + "y"`, keys(new Field32()));
watch(String(globalThis.nothing || "x"));
class Field33 extends Above { [globalThis.nothing || "x"] = 1; y = 2; }
console.log(33, String.raw`globalThis.nothing || "x"`, keys(new Field33()));
watch(String(globalThis.nothing && "x"));
class Field34 extends Above { [globalThis.nothing && "x"] = 1; y = 2; }
console.log(34, String.raw`globalThis.nothing && "x"`, keys(new Field34()));
