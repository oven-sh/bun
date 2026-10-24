const log: string[] = [];
function show(label: string, make: () => unknown): void {
  log.length = 0;
  let result: string;
  try {
    result = JSON.stringify(make());
  } catch (error) {
    result = "threw " + (error as Error).name + ": " + (error as Error).message;
  }
  console.log(label, result, log.length ? "[" + log.join(" ") + "]" : "");
}

interface Item {
  name: string;
  count: number;
}
const items: Item[] = [];
for (let i = 0; i < 5; i++) items.push({ name: "n" + i, count: i * i });
function row(item: Item): string {
  return `<li>${item.name}=${item.count}</li>`;
}

show("typed rows", () => items.map(row).join("\n"));
show("arrow", () => items.map(item => row(item)).join(""));
show("in a template", () => `<ul>${items.map(item => `<li>${item.name}</li>`).join(", ")}</ul>`);
show("nested", () => items.map(item => `(${items.map(inner => inner.count + item.count).join("+")})`).join(";"));
show("empty", () => ([] as Item[]).map(row).join("-"));
show("one", () => [items[3]!].map(row).join("-"));
show("index and array", () => items.map((item, index, all) => item.name + index + all.length).join("|"));

show("numbers", () => [1, 2, 3].map(x => x * 2).join(","));
show("doubles", () => [1.5, 2.5, -0].map(x => x / 2).join(" "));
show("doubles to strings", () => [1.5, 2.25].map(x => x.toFixed(1)).join("|"));
show("null and undefined", () => [1, 2, 3, 4].map(x => (x === 2 ? null : x === 3 ? undefined : "v" + x)).join("/"));
show("strings then a number", () => [1, 2, 3, 4].map((x): string | number => (x < 3 ? "s" + x : x)).join("/"));
show("booleans and bigints", () => [1, 2].map((x): unknown => (x === 1 ? true : 10n)).join("&"));
show("arrays", () => [1, 2].map(x => [x, [x + 1, null]]).join(";"));
show("symbol", () => [1, 2, 3].map((x): unknown => (log.push("call" + x), x === 2 ? Symbol("s") : "v")).join(","));

show("toString runs after every callback", () =>
  [1, 2, 3]
    .map(x => {
      log.push("call" + x);
      return x === 1
        ? "first"
        : {
            toString() {
              log.push("toString" + x);
              return "o" + x;
            },
          };
    })
    .join(","),
);
show("toString throws", () =>
  [1, 2, 3]
    .map(x => {
      log.push("call" + x);
      return {
        toString(): string {
          log.push("toString" + x);
          if (x === 2) throw new RangeError("no string for 2");
          return "o" + x;
        },
      };
    })
    .join(","),
);
show("callback throws", () =>
  [1, 2, 3]
    .map(x => {
      log.push("call" + x);
      if (x === 2) throw new Error("stop at 2");
      return "v" + x;
    })
    .join(","),
);

// prettier-ignore
show("holes", () => ["a", , "c", , ].map(x => (log.push("call" + x), x + "!")).join("-"));
show("only holes", () => new Array<string>(3).map(x => (log.push("never"), x)).join("-"));
// prettier-ignore
show("holes in doubles", () => [1.5, , 2.5].map(x => "d" + x).join("-"));

show("grows", () => {
  const list = ["a", "b"];
  return list.map(x => (list.push(x + x), x)).join(",") + " " + list.length;
});
show("shrinks", () => {
  const list = ["a", "b", "c", "d"];
  return list.map(x => (list.pop(), x)).join(",") + " " + list.length;
});
show("emptied", () => {
  const list = ["a", "b", "c"];
  return list.map(x => ((list.length = 0), x)).join(",");
});
show("later elements replaced", () => {
  const list = ["a", "b", "c"];
  return list.map((x, i) => ((list[i + 1] = x + i), x)).join(",");
});
show("doubles become strings", () => {
  const list: unknown[] = [1.5, 2.5, 3.5];
  return list.map((x, i) => ((list[2] = "late"), x + ":" + i)).join(",");
});
show("becomes sparse", () => {
  const list: string[] = ["a", "b", "c"];
  return list.map(x => ((list[100000] = "far"), x)).join(",") + " " + list.length;
});

class List<T> extends Array<T> {
  override join(separator?: string): string {
    return "List.join(" + separator + ") of " + this.length;
  }
}
show("a subclass with its own join", () => List.from(["a", "b"]).map(x => x + x).join("+"));
class Plain<T> extends Array<T> {
  static override get [Symbol.species](): ArrayConstructor {
    log.push("species");
    return Array;
  }
}
show("a subclass whose species is Array", () => Plain.from(["a", "b"]).map(x => x + x).join("+"));
show("an own map", () => {
  const list = ["a", "b"];
  (list as any).map = () => ["own", "map"];
  return list.map(x => x).join("+");
});
show("no function", () => (items as any).map(undefined).join(","));
function render(list: Item[]): string {
  return `<ul>${list.map(item => `<li class="item-of-a-list">${item.name}</li>`).join("\n")}</ul>`;
}
show("fused", () => render(items));
function nameOfErrorFrom(make: () => unknown): string {
  try {
    return "returned " + JSON.stringify(make());
  } catch (error) {
    return (error as Error).name;
  }
}
show("fused, no array", () => nameOfErrorFrom(() => render(undefined as any)));
show("fused, null", () => nameOfErrorFrom(() => render(null as any)));
show("fused, map is no function", () => nameOfErrorFrom(() => render(Object.assign([items[0]!], { map: 5 }) as any)));
show("fused, map returns no array", () => nameOfErrorFrom(() => render(Object.assign([items[0]!], { map: () => 7 }) as any)));
show("fused, an own map", () => render(Object.assign([items[0]!], { map: () => ["own", "map"] }) as any));
show("fused, a subclass", () => render(List.from(items)));
show("this argument", () =>
  ["a", "b"]
    .map(function (this: { suffix: string }, x: string) {
      return x + this.suffix;
    }, { suffix: "?" })
    .join(","),
);
show("untyped receiver", () => {
  const list: any = JSON.parse('["x","y","z"]');
  return list.map((x: string) => x.toUpperCase()).join("");
});
show("array-like receiver", () => Array.prototype.map.call({ length: 2, 0: "p", 1: "q" }, x => x + "'").join(","));

show("separator from a variable", () => {
  let separator = ",";
  return ["a", "b", "c"].map(x => ((separator = ";"), x)).join(separator);
});
show("default separator", () => ["a", "b"].map(x => x + x).join());
show("undefined separator", () => ["a", "b"].map(x => x + x).join(undefined));
show("inside try", () => {
  try {
    return ["a", "b"].map(x => x + x).join("~");
  } catch {
    return "caught";
  }
});
show("the array is also kept", () => {
  const mapped = ["a", "b"].map(x => x + x);
  return mapped.join("~") + mapped.length;
});
show("16-bit text", () => ["é", "日本", "x"].map(x => `<${x}>`).join("→"));

const many: number[] = [];
for (let i = 0; i < 100_000; i++) many.push(i);
const text = `[${many.map(i => "item" + (i % 1000)).join(", ")}]`;
let sum = 0;
for (let i = 0; i < text.length; i += 997) sum = (sum * 31 + text.charCodeAt(i)) | 0;
console.log("many", text.length, sum, text.slice(-20));
