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
watch(String(0x1n + ""));
class Field1 extends Above { [0x1n + ""] = 1; y = 2; }
console.log(1, String.raw`0x1n + ""`, keys(new Field1()));
watch(String("" + 0x1n));
class Field2 extends Above { ["" + 0x1n] = 1; y = 2; }
console.log(2, String.raw`"" + 0x1n`, keys(new Field2()));
watch(String(1n + ""));
class Field3 extends Above { [1n + ""] = 1; y = 2; }
console.log(3, String.raw`1n + ""`, keys(new Field3()));
watch(String(`${0x1n}`));
class Field4 extends Above { [`${0x1n}`] = 1; y = 2; }
console.log(4, String.raw`\`\${0x1n}\``, keys(new Field4()));
watch(String(`${1n}`));
class Field5 extends Above { [`${1n}`] = 1; y = 2; }
console.log(5, String.raw`\`\${1n}\``, keys(new Field5()));
watch(String(`a${0x1n}`));
class Field6 extends Above { [`a${0x1n}`] = 1; y = 2; }
console.log(6, String.raw`\`a\${0x1n}\``, keys(new Field6()));
watch(String(0x1n ? "x" : "z"));
class Field7 extends Above { [0x1n ? "x" : "z"] = 1; y = 2; }
console.log(7, String.raw`0x1n ? "x" : "z"`, keys(new Field7()));
watch(String(1n ? "x" : "z"));
class Field8 extends Above { [1n ? "x" : "z"] = 1; y = 2; }
console.log(8, String.raw`1n ? "x" : "z"`, keys(new Field8()));
watch(String(0x0n ? "x" : "z"));
class Field9 extends Above { [0x0n ? "x" : "z"] = 1; y = 2; }
console.log(9, String.raw`0x0n ? "x" : "z"`, keys(new Field9()));
watch(String(0n ? "x" : "z"));
class Field10 extends Above { [0n ? "x" : "z"] = 1; y = 2; }
console.log(10, String.raw`0n ? "x" : "z"`, keys(new Field10()));
watch(String(!0x1n ? "x" : "z"));
class Field11 extends Above { [!0x1n ? "x" : "z"] = 1; y = 2; }
console.log(11, String.raw`!0x1n ? "x" : "z"`, keys(new Field11()));
watch(String(0x1n && "x"));
class Field12 extends Above { [0x1n && "x"] = 1; y = 2; }
console.log(12, String.raw`0x1n && "x"`, keys(new Field12()));
watch(String(1n && "x"));
class Field13 extends Above { [1n && "x"] = 1; y = 2; }
console.log(13, String.raw`1n && "x"`, keys(new Field13()));
watch(String(0n || "x"));
class Field15 extends Above { [0n || "x"] = 1; y = 2; }
console.log(15, String.raw`0n || "x"`, keys(new Field15()));
watch(String(0x1n ?? "x"));
class Field16 extends Above { [0x1n ?? "x"] = 1; y = 2; }
console.log(16, String.raw`0x1n ?? "x"`, keys(new Field16()));
watch(String(typeof 0x1n));
class Field17 extends Above { [typeof 0x1n] = 1; y = 2; }
console.log(17, "typeof 0x1n", keys(new Field17()));
watch(String(typeof 1n));
class Field18 extends Above { [typeof 1n] = 1; y = 2; }
console.log(18, "typeof 1n", keys(new Field18()));
watch(String(0x1n === 0x1n ? "x" : "z"));
class Field19 extends Above { [0x1n === 0x1n ? "x" : "z"] = 1; y = 2; }
console.log(19, String.raw`0x1n === 0x1n ? "x" : "z"`, keys(new Field19()));
watch(String(0x1n === 1n ? "x" : "z"));
class Field20 extends Above { [0x1n === 1n ? "x" : "z"] = 1; y = 2; }
console.log(20, String.raw`0x1n === 1n ? "x" : "z"`, keys(new Field20()));
watch(String(1n === 1n ? "x" : "z"));
class Field21 extends Above { [1n === 1n ? "x" : "z"] = 1; y = 2; }
console.log(21, String.raw`1n === 1n ? "x" : "z"`, keys(new Field21()));
watch(String(0x1n === null ? "x" : "z"));
class Field22 extends Above { [0x1n === null ? "x" : "z"] = 1; y = 2; }
console.log(22, String.raw`0x1n === null ? "x" : "z"`, keys(new Field22()));
watch(String(0x1_0n === 0x10n ? "x" : "z"));
class Field23 extends Above { [0x1_0n === 0x10n ? "x" : "z"] = 1; y = 2; }
console.log(23, String.raw`0x1_0n === 0x10n ? "x" : "z"`, keys(new Field23()));
watch(String(0xan === 0xAn ? "x" : "z"));
class Field24 extends Above { [0xan === 0xAn ? "x" : "z"] = 1; y = 2; }
console.log(24, String.raw`0xan === 0xAn ? "x" : "z"`, keys(new Field24()));
watch(String(`é${1}`));
class Field25 extends Above { [`é${1}`] = 1; y = 2; }
console.log(25, String.raw`\`é\${1}\``, keys(new Field25()));
watch(String(`a${1}`));
class Field26 extends Above { [`a${1}`] = 1; y = 2; }
console.log(26, String.raw`\`a\${1}\``, keys(new Field26()));
watch(String(`${1}é`));
class Field27 extends Above { [`${1}é`] = 1; y = 2; }
console.log(27, String.raw`\`\${1}é\``, keys(new Field27()));
watch(String(`${"é"}`));
class Field28 extends Above { [`${"é"}`] = 1; y = 2; }
console.log(28, String.raw`\`\${"é"}\``, keys(new Field28()));
watch(String(`${"a"}`));
class Field29 extends Above { [`${"a"}`] = 1; y = 2; }
console.log(29, String.raw`\`\${"a"}\``, keys(new Field29()));
watch(String(`é`));
class Field30 extends Above { [`é`] = 1; y = 2; }
console.log(30, String.raw`\`é\``, keys(new Field30()));
watch(String(`é${1}` ? "x" : "z"));
class Field31 extends Above { [`é${1}` ? "x" : "z"] = 1; y = 2; }
console.log(31, String.raw`\`é\${1}\` ? "x" : "z"`, keys(new Field31()));
watch(String(`a${1}` ? "x" : "z"));
class Field32 extends Above { [`a${1}` ? "x" : "z"] = 1; y = 2; }
console.log(32, String.raw`\`a\${1}\` ? "x" : "z"`, keys(new Field32()));
watch(String(`a${1}` === "a1" ? "x" : "z"));
class Field33 extends Above { [`a${1}` === "a1" ? "x" : "z"] = 1; y = 2; }
console.log(33, String.raw`\`a\${1}\` === "a1" ? "x" : "z"`, keys(new Field33()));
watch(String(`é${1}` === "é1" ? "x" : "z"));
class Field34 extends Above { [`é${1}` === "é1" ? "x" : "z"] = 1; y = 2; }
console.log(34, String.raw`\`é\${1}\` === "é1" ? "x" : "z"`, keys(new Field34()));
watch(String("é" + 1));
class Field35 extends Above { ["é" + 1] = 1; y = 2; }
console.log(35, String.raw`"é" + 1`, keys(new Field35()));
watch(String("a" + 1));
class Field36 extends Above { ["a" + 1] = 1; y = 2; }
console.log(36, String.raw`"a" + 1`, keys(new Field36()));
