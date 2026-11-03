// An object with many optional fields keeps most of them out of line. Whatever it holds there, objects, strings, arrays, closures and numbers in any mix, survives collections, and what it dropped does not come back.
interface Options {
  f00?: Options; f01?: string; f02?: number; f03?: Options; f04?: string[]; f05?: number; f06?: () => number; f07?: string; f08?: number; f09?: Options;
  f10?: Options; f11?: string; f12?: number; f13?: Options; f14?: string[]; f15?: number; f16?: () => number; f17?: string; f18?: number; f19?: Options;
  f20?: Options; f21?: string; f22?: number; f23?: Options; f24?: string[]; f25?: number; f26?: () => number; f27?: string; f28?: number; f29?: Options;
  f30?: Options; f31?: string; f32?: number; f33?: Options; f34?: string[]; f35?: number; f36?: () => number; f37?: string; f38?: number; f39?: Options;
}
function make(length: number): Options {
  let head: Options = { f01: "end" };
  for (let i = 0; i < length; i++) {
    const next: Options = { f01: "n" + i };
    switch (i % 5) {
      case 0: next.f00 = head; next.f12 = i; next.f14 = ["a" + i]; break;
      case 1: next.f13 = head; next.f24 = ["b" + i, "c"]; next.f27 = "s" + i; break;
      case 2: next.f29 = head; next.f38 = i / 2; next.f36 = () => i; break;
      case 3: next.f39 = head; next.f05 = i; next.f06 = () => i * 2; next.f37 = "t" + i; break;
      default: next.f20 = head; next.f21 = "u" + i; next.f22 = i; next.f23 = { f11: "leaf" + i }; next.f34 = []; break;
    }
    head = next;
  }
  return head;
}
function sum(head: Options): string {
  let count = 0;
  let numbers = 0;
  let characters = 0;
  for (let node: Options | undefined = head; node; node = node.f00 ?? node.f13 ?? node.f29 ?? node.f39 ?? node.f20) {
    count++;
    numbers += (node.f12 ?? 0) + (node.f38 ?? 0) + (node.f05 ?? 0) + (node.f22 ?? 0) + (node.f36?.() ?? 0) + (node.f06?.() ?? 0);
    characters += (node.f01?.length ?? 0) + (node.f27?.length ?? 0) + (node.f37?.length ?? 0) + (node.f21?.length ?? 0) + (node.f23?.f11?.length ?? 0);
    characters += (node.f14?.join("").length ?? 0) + (node.f24?.join("").length ?? 0) + (node.f34?.length ?? 0);
  }
  return [count, numbers, characters].join(" ");
}
const kept = make(30000);
console.log(sum(kept));
for (let round = 0; round < 4; round++) {
  make(20000);
  Bun.gc(true);
  console.log(round, sum(kept));
}
let dropped = 0;
for (let node: Options | undefined = kept; node; node = node.f00 ?? node.f13 ?? node.f29 ?? node.f39 ?? node.f20) {
  if (node.f23) {
    node.f23 = undefined;
    delete node.f34;
    dropped++;
  }
  if (node.f14) node.f15 = node.f14.length;
}
Bun.gc(true);
make(20000);
Bun.gc(true);
console.log(dropped, sum(kept));
