// Writes programs of everyday loops over lists: sorts, searches, sieves, sums, moves of elements, heaps, tables, queues, rings, checksums and walks by index. For write-random-algorithm-sweep.ts and for a scene of write-ordinary-scenes.ts.
// Lists hold whole numbers, fractions, strings, objects or holes, or are views. They are parameters, variables of the file or fields. Bounds are read every turn or kept, counters go up or down and begin at either end, and indexes lie a few elements off.
// Some loops call a function that now and then changes the list, and each function runs on lists of several kinds.
// Each program prints every result and what the lists hold at its end.

/** The lines of a program, or of a part of one, whose names end in `suffix` and that prints by `print`. */
export function writeListAlgorithms(next: () => number, isTyped: boolean, print = "console.log", suffix = "") {
  const random = {
    below: (end: number) => Math.floor(next() * end),
    chance: (of: number) => next() < of,
    pick: <T>(from: readonly T[]): T => from[Math.floor(next() * from.length)],
  };
  const indent = (lines: string[]) => lines.flatMap(line => line.split("\n")).map(line => "  " + line);
  const any = isTyped ? ": any" : "";
  const number = isTyped ? ": number" : "";
  const elementType = isTyped ? random.pick([": number[]", ": number[]", ": any", ": any[]"]) : "";
  const isNumeric = elementType === ": number[]";
  const cast = elementType.endsWith("[]") ? " as any" : "";
  const values = (from: string[], most = 9) => Array.from({ length: random.below(most) }, () => random.pick(from)).join(", "); // prettier-ignore
  const wholes = ["1", "2", "3", "4", "5", "0", "7", "9", "12", "6"];
  const listOf = () =>
    random.pick([
      () => `[${values(wholes)}]`,
      () => `[${values(wholes)}]`,
      () => `[${values(wholes, 20)}]`,
      () => `[${values(["0.5", "1.5", "2", "-1", "3.25", "1e3"])}]`,
      () => `[${values(["1", "-0", "NaN", "Infinity", "2", "-5"])}]`,
      () => `JSON.parse("[${values(wholes)}]")`,
      () =>
        `Array.from({ length: ${random.below(12)} }, (_, at) => ${random.pick(["at", "at * 7 % 5", "at / 2", "9 - at"])})`,
      () => `new Array(${1 + random.below(6)}).fill(${random.pick(["0", "3", "0.5"])})`,
      () => `([${values(["1", "2", "3"], 4)}, , 4, 1]${cast})`,
      () => `(new Uint8Array([${values([...wholes, "255", "128"])}])${cast})`,
      () => `(new Float64Array([${values(["0.5", "1", "2", "-3"])}])${cast})`,
      () => `(new Int32Array([${values([...wholes, "-7", "2147483647"])}])${cast})`,
      () => `([${values(['"b"', '"a"', '"c"', '"ab"', '""'])}]${cast})`,
      () => `([${values(["1", '"2"', "null", "undefined", "true", "3"])}]${cast})`,
      () => `([${values(["2147483647", "2147483646", "-2147483648", "1"])}]${cast})`,
      () => "[]",
    ])();
  const offset = (text: string) =>
    random.chance(0.12) ? `${text} ${random.pick(["+ 1", "- 1", "+ 2", "- 2"])}` : text;
  const middle = (low: string, high: string) =>
    random.pick([`(${low} + ${high}) >> 1`, `(${low} + ${high}) >>> 1`, `Math.floor((${low} + ${high}) / 2)`, `${low} + ((${high} - ${low}) >> 1)`, `((${low} + ${high}) / 2) | 0`]); // prettier-ignore
  const up = (name: string) => random.pick([`${name}++`, `${name}++`, `${name} += 1`, `++${name}`]);
  const down = (name: string) => random.pick([`${name}--`, `${name}--`, `${name} -= 1`, `--${name}`]);
  const swap = (list: string, a: string, b: string) =>
    random.pick([
      `[${list}[${a}], ${list}[${b}]] = [${list}[${b}], ${list}[${a}]];`,
      `const held = ${list}[${a}];\n${list}[${a}] = ${list}[${b}];\n${list}[${b}] = held;`,
    ]);
  const newList = (length: string, fill: string) =>
    random.pick([
      `new Array(${length}).fill(${fill})`,
      `Array.from({ length: ${length} }, () => ${fill})`,
      `new Float64Array(${length})`,
      `new Int32Array(${length})`,
      `new Uint8Array(${length})`,
      "[]",
    ]);
  const functionCount = 1 + random.below(3);
  const hasDisturb = random.chance(0.35);
  const lines: string[] = [
    "let turns = 0;",
    `let best${any} = 0;`,
    `const state${any} = { sum: 0, list: ${listOf()}, at: 0 };`,
    `const fixed${elementType} = ${listOf()};`,
    `function show(value${any})${any} {`,
    '  return Object.is(value, -0) ? "-0" : typeof value === "object" && value !== null ? "[" + Array.prototype.map.call(value.length === undefined || value.length > 99 ? Object.entries(value) : value, show).join() + "]" : String(value);', // prettier-ignore
    "}",
  ];
  if (hasDisturb)
    lines.push(
      `function disturb(list${any}, turn${any}) {`,
      `  if (turn === ${random.below(4)}) ${random.pick(["list[0] = 0.5;", 'list[1] = "text";', "list.pop?.();", "list.push?.(3);", "list.length = 2;", "delete list[1];", "list[list.length] = 1;", "list.reverse();", "list.extra = 1;", "list[2] = undefined;", "state.list = list;", "list.unshift?.(8);", "list.splice?.(1, 1);"])}`, // prettier-ignore
      "}",
    );
  // The loops. `L` is the list, `count` a small whole number.
  const algorithms: Record<string, () => string[]> = {
    move: () => {
      const isDown = random.chance(0.6);
      const [to, from] = [random.pick(["i", "i", "i - 1", "i + 1"]), random.pick(["i - 1", "i - 2", "i + 1", "i", "i + 2"])]; // prettier-ignore
      const change = random.pick(["", "", " + 1", " * 2", " | 0"]);
      const head = isDown
        ? `for (let i = ${random.pick(["L.length", "L.length - 1", "count", "L.length - 2"])}; i ${random.pick(["> 0", ">= 0", "> 1", "!== 0 && i > 0"])}; ${down("i")})`
        : random.chance(0.5)
          ? `for (let i = ${random.pick(["0", "1", "2"])}, end = L.length; i < ${offset("end")}; ${up("i")})`
          : `for (let i = ${random.pick(["0", "1", "2"])}; i < ${random.pick(["count", "L.length && i < 30", "L.length - 1 && i < 30"])}; ${up("i")})`;
      return [`${head} L[${to}] = L[${from}]${change};`, "result = L.length;"];
    },
    insertion: () => [
      `for (let i = 1; i < L.length; ${up("i")}) {`,
      "  const one = L[i];",
      ...(random.chance(0.5)
        ? [
            "  let j = i - 1;",
            `  while (j >= 0 && L[j] > one) {`,
            "    L[j + 1] = L[j];",
            `    ${down("j")};`,
            "  }",
            "  L[j + 1] = one;",
          ]
        : ["  let j = i;", "  for (; j > 0 && L[j - 1] > one; j--) L[j] = L[j - 1];", "  L[j] = one;"]),
      "}",
    ],
    selection: () => [
      `for (let i = 0; i < L.length${random.pick([" - 1", ""])}; ${up("i")}) {`,
      "  let least = i;",
      `  for (let j = ${offset("i + 1")}; j < L.length; ${up("j")}) if (L[j] < L[least]) least = j;`,
      `  if (least !== i) {\n    ${swap("L", "i", "least").replaceAll("\n", "\n    ")}\n  }`,
      "}",
    ],
    bubble: () => [
      "let swapped = true;",
      "for (let pass = 0; swapped && pass < 25; pass++) {",
      "  swapped = false;",
      `  for (let i = ${random.pick(["1; i < L.length; i++", "L.length - 1; i > 0; i--"])})`,
      `    if (L[i - 1] > L[i]) {\n      ${swap("L", "i - 1", "i").replaceAll("\n", "\n      ")}\n      swapped = true;\n    }`,
      "}",
    ],
    reverse: () => [
      "let low = 0;",
      "let high = L.length - 1;",
      "while (low < high) {",
      ...indent([
        random.chance(0.5)
          ? "const held = L[low];\nL[low++] = L[high];\nL[high--] = held;"
          : `${swap("L", "low", "high")}\nlow++;\nhigh--;`,
      ]),
      "}",
      "result = low;",
    ],
    prefix: () => [
      `const sums${any} = ${random.pick(["[0]", newList("L.length", "0")])};`,
      `for (let i = ${offset(random.pick(["0", "1"]))}; i < L.length; ${up("i")}) sums[i] = (sums[i - 1] ${random.pick(["|| 0", "?? 0"])}) + L[i];`,
      "result = sums;",
    ],
    sieve: () => [
      `const marks${any} = ${newList("count * 8 + 1", "true")};`,
      `for (let i = 2; i * i <= count * 8; ${up("i")})`,
      `  ${random.pick(["if (marks[i]) ", "if (!marks[i]) ", ""])}for (let j = ${random.pick(["i * i", "i * 2"])}; j <= count * 8; j += i) marks[j] = ${random.pick(["false", "1", "j"])};`,
      "result = marks;",
    ],
    search: () => [
      "let low = 0;",
      "let high = L.length;",
      "while (low < high) {",
      `  const middle = ${middle("low", "high")};`,
      `  if (L[middle] ${random.pick(["<", "<="])} count) low = middle + 1;`,
      "  else high = middle;",
      "}",
      "result = low;",
    ],
    partition: () => [
      `const pivot = L[${random.pick(["0", "L.length - 1", "L.length >> 1"])}];`,
      "let place = 0;",
      `for (let i = 0; i < L.length; ${up("i")})`,
      `  if (L[i] < pivot) {\n    ${swap("L", "i", "place").replaceAll("\n", "\n    ")}\n    place++;\n  }`,
      "result = place;",
    ],
    heap: () => [
      `const heap${any} = [];`,
      `for (const one of L) {`,
      "  heap.push(one);",
      "  let i = heap.length - 1;",
      "  while (i > 0) {",
      "    const parent = (i - 1) >> 1;",
      "    if (heap[parent] <= heap[i]) break;",
      `    ${swap("heap", "parent", "i").replaceAll("\n", "\n    ")}`,
      "    i = parent;",
      "  }",
      "}",
      "result = heap;",
      ...(random.chance(0.5)
        ? [
            `const sorted${any} = [];`,
            "while (heap.length) {",
            "  sorted.push(heap[0]);",
            `  const last${any} = heap.pop();`,
            "  if (!heap.length) break;",
            "  heap[0] = last;",
            "  for (let i = 0, child = 1; child < heap.length; child = i * 2 + 1) {",
            "    if (child + 1 < heap.length && heap[child + 1] < heap[child]) child++;",
            "    if (heap[i] <= heap[child]) break;",
            "    const held = heap[i];\n    heap[i] = heap[child];\n    heap[child] = held;\n    i = child;",
            "  }",
            "}",
            "result = sorted;",
          ]
        : []),
    ],
    grid: () => [
      `const rows${any} = Array.from({ length: count }, (_, row) => ${newList("count", "row")});`,
      `for (let row = ${random.pick(["0", "1"])}; row < count; ${up("row")})`,
      `  for (let column = 0; column < ${random.pick(["count", "row + 1", "rows[row].length && column < 9"])}; ${up("column")})`,
      `    rows[row][column] = ${random.pick(["(rows[row - 1]?.[column] ?? 1) + (rows[row][column - 1] ?? 1)", "row * column + (L[column] ?? 0)", "rows[column]?.[row] ?? row", "row === column ? 1 : 0"])};`,
      "result = rows;",
    ],
    window: () => [
      `let sum${any} = 0;`,
      `const averages${any} = [];`,
      `for (let i = 0; i < L.length; ${up("i")}) {`,
      "  sum += L[i];",
      `  if (i >= ${offset("count")}) sum -= L[i - count];`,
      "  averages.push(sum / count);",
      "}",
      "result = averages;",
    ],
    unique: () => [
      "let place = 0;",
      `for (let i = 0; i < L.length; ${up("i")}) if (i === 0 || L[i] !== L[place - 1]) L[place++] = L[i];`,
      ...(random.chance(0.4) && !isNumeric ? ["if (Array.isArray(L)) L.length = place;"] : []),
      "result = place;",
    ],
    counts: () => [
      `const counts${any} = ${random.pick(["[]", "{}", newList("8", "0"), "Object.create(null)"])};`,
      random.pick([
        `for (let i = 0; i < L.length; ${up("i")}) counts[L[i] & 7] = (counts[L[i] & 7] ?? 0) + 1;`,
        `for (const one of L) counts[${isNumeric ? "one" : "String(one)"}] = (counts[${isNumeric ? "one" : "String(one)"}] || 0) + 1;`,
        `for (let i = L.length; i--; ) counts[(L[i] >>> 0) % 5]++;`,
        `for (let i = 0; i < L.length; i++) counts[i % 3] = L[i];`,
      ]),
      "result = counts;",
    ],
    ring: () => [
      `const ring${any} = ${newList("count", "0")};`,
      "let head = 0;",
      "let used = 0;",
      `for (let i = 0; i < L.length; ${up("i")}) {`,
      `  ring[(head + used) % count] = L[i];`,
      "  if (used < count) used++;",
      "  else head = (head + 1) % count;",
      "}",
      "result = [head, used, ring];",
    ],
    queue: () => [
      `const queue${any} = [0];`,
      `const seen${any} = ${random.pick(["new Set([0])", "[true]", "{ 0: true }"])};`,
      "let head = 0;",
      "while (head < queue.length && head < 200) {", // a caller may hand over what makes no bound
      "  const at = queue[head++];",
      `  for (const to of [at + 1, at * 2 + 1${random.chance(0.4) ? ", at - 1" : ""}]) {`,
      "    if (to < 0 || to >= L.length + count) continue;",
      "    if (seen instanceof Set ? seen.has(to) : seen[to]) continue;",
      "    if (seen instanceof Set) seen.add(to);\n    else seen[to] = true;",
      "    queue.push(to);",
      "  }",
      "}",
      "result = queue;",
    ],
    extremes: () => [
      "let least = L[0];",
      "let most = L[0];",
      "let where = 0;",
      random.pick([
        `for (let i = 1; i < L.length; ${up("i")}) {`,
        `for (let i = L.length - 1; i >= 0; ${down("i")}) {`,
      ]),
      "  if (L[i] < least) least = L[i];",
      "  if (L[i] > most) {\n    most = L[i];\n    where = i;\n  }",
      "}",
      "result = [least, most, where];",
    ],
    merge: () => [
      `const merged${any} = [];`,
      "let i = 0;",
      "let j = 0;",
      "while (i < L.length && j < fixed.length) merged.push(L[i] <= fixed[j] ? L[i++] : fixed[j++]);",
      "while (i < L.length) merged.push(L[i++]);",
      random.pick([
        "while (j < fixed.length) merged.push(fixed[j++]);",
        "for (; j < fixed.length; j++) merged[merged.length] = fixed[j];",
      ]),
      "result = merged;",
    ],
    pairs: () => [
      "let found = 0;",
      `for (let i = 0; i < L.length; ${up("i")})`,
      `  for (let j = ${random.pick(["i + 1", "i", "0", "L.length - 1"])}; ${"j < L.length"}; ${up("j")})`,
      `    ${random.pick(["if (L[i] + L[j] === count) found++;", "if (L[i] > L[j]) found += j - i;", "found += (L[i] === L[j] ? 1 : 0);", "if (L[j] === 0) break;\n    else found++;"])}`,
      "result = found;",
    ],
    polynomial: () => [
      `let value${any} = 0;`,
      random.pick([
        `for (let i = L.length - 1; i >= 0; ${down("i")}) value = value * count + L[i];`,
        "for (let i = L.length; i-- > 0; ) value = value * count + L[i];",
        "let i = L.length;\nwhile (--i >= 0) value = value * 0.5 + L[i];",
        "let i = L.length;\nwhile (i > 0) value = value * 2 + L[--i];",
      ]),
      "result = value;",
    ],
    checksum: () => [
      `let hash = ${random.pick(["0", "5381", "0x811c9dc5", "-1", "1"])};`,
      `for (let i = 0; i < ${random.pick(["L.length", "count * 3"])}; ${up("i")}) {`,
      `  hash = ${random.pick(["(hash * 33) ^ L[i % (L.length || 1)]", "Math.imul(hash ^ L[i % (L.length || 1)], 16777619)", "(hash << 5) - hash + L[i % (L.length || 1)]", "(hash >>> 1) ^ (hash & 1 ? 0xedb88320 : 0) ^ L[i % (L.length || 1)]", "(hash + L[i % (L.length || 1)]) % 65521"])};`,
      ...(random.chance(0.5) ? [`  hash ${random.pick(["|= 0", ">>>= 0", "&= 0xffff"])};`] : []),
      "}",
      "result = hash;",
    ],
    strides: () => {
      const step = 2 + random.below(3);
      return [
        `let sum${any} = 0;`,
        `for (let i = ${random.pick(["0", "0", "1"])}; i ${random.pick([`+ ${step} <= L.length`, "< L.length", `< L.length - ${step - 1}`, `+ ${step - 1} < L.length`])}; i += ${step})`,
        `  sum += ${Array.from({ length: step }, (_, at) => `L[i${at ? " + " + at : ""}]${random.pick(["", "", " * 2", " << 1"])}`).join(" + ")};`,
        "result = sum;",
      ];
    },
    stack: () => [
      `const stack${any} = [];`,
      `for (let i = 0; i < L.length; ${up("i")}) {`,
      `  while (stack.length && ${random.pick(["stack[stack.length - 1] < L[i]", "L[stack[stack.length - 1]] < L[i]", "stack.at(-1) >= L[i]"])}) stack.pop();`,
      `  stack.push(${random.pick(["L[i]", "i"])});`,
      "}",
      "result = stack;",
    ],
    roots: () => [
      `const parents${any} = Array.from({ length: count + 4 }, (_, at) => at);`,
      `const root = (one${number})${number} => {`,
      "  while (parents[one] !== one) {\n    parents[one] = parents[parents[one]];\n    one = parents[one];\n  }",
      "  return one;",
      "};",
      `for (let i = 0; i + 1 < L.length; ${up("i")}) {`,
      "  const [left, right] = [root((L[i] >>> 0) % (count + 4)), root((L[i + 1] >>> 0) % (count + 4))];",
      "  if (left !== right) parents[left] = right;",
      "}",
      "result = parents;",
    ],
    links: () => [
      `const nexts${any} = L.${isNumeric ? "map" : "length === undefined ? [] : Array.from(L).map"}((_${any}, at${number}) => (at + 1 < L.length ? at + 1 : -1));`.replace(/L\.length === undefined/, "L.length === undefined"), // prettier-ignore
      "let walked = 0;",
      "for (let at = nexts.length ? 0 : -1; at !== -1 && walked < 50; at = nexts[at]) walked += 1;",
      "result = walked;",
    ],
    row: () => [
      `const row${any} = ${newList("count + 1", "0")};`,
      "row[0] = 1;",
      `for (let i = 1; i <= count; ${up("i")}) for (let j = i; j > 0; ${down("j")}) row[j] = (row[j] ?? 0) + row[j - 1];`,
      "result = row;",
    ],
    sack: () => [
      `const gains${any} = ${newList("count * 3 + 1", "0")};`,
      `for (let i = 0; i < L.length; ${up("i")}) {`,
      "  const weight = ((L[i] >>> 0) % 4) + 1;",
      `  for (let room = count * 3; room >= weight; ${down("room")}) gains[room] = Math.max(gains[room] ?? 0, (gains[room - weight] ?? 0) + i + 1);`,
      "}",
      "result = gains;",
    ],
    common: () => [
      `let before${any} = ${newList("fixed.length + 1", "0")};`,
      `let now${any} = ${newList("fixed.length + 1", "0")};`,
      `for (let i = 1; i <= L.length; ${up("i")}) {`,
      `  for (let j = 1; j <= fixed.length; ${up("j")})`,
      "    now[j] = L[i - 1] === fixed[j - 1] ? (before[j - 1] ?? 0) + 1 : Math.max(before[j] ?? 0, now[j - 1] ?? 0);",
      "  [before, now] = [now, before];",
      "}",
      "result = before;",
    ],
    bytes: () => [
      `const words${any} = [];`,
      `for (let i = 0; i + 1 < L.length; i += 2) words.push(${random.pick(["(L[i] << 8) | L[i + 1]", "L[i] + L[i + 1] * 256", "(L[i] << 24) | L[i + 1]", "((L[i] << 24) | L[i + 1]) >>> 0"])});`,
      "result = words;",
    ],
    scale: () => [
      `for (let i = ${random.pick(["0; i < L.length; i++", "L.length - 1; i >= 0; i--", "0, end = L.length; i < end; ++i"])}) L[i] = ${random.pick(["L[i] * 1.5", "L[i] + 1", "L[i] > 4 ? 4 : L[i]", "(L[i] * 3) & 255", "-L[i]", "L[i] - L[0]", "L[L.length - 1 - i]", "Math.max(0, Math.min(255, L[i] * 40))"])};`,
      "result = L[0];",
    ],
    group: () => [
      `const groups${any} = {};`,
      `for (let i = 0; i < L.length; ${up("i")}) (groups["k" + (L[i] % 3)] ??= []).push(${random.pick(["i", "L[i]", "[i, L[i]]"])});`,
      "result = Object.keys(groups).map(key => [key, groups[key]]);",
    ],
    chunk: () => [
      `const chunks${any} = [];`,
      "for (let i = 0; i < L.length; i += count) chunks.push(L.slice(i, i + count));",
      "result = chunks;",
    ],
    recursive: () => [
      `const split = (low${number}, high${number})${any} => {`,
      `  if (high - low < 2) return low < high ? L[low] : ${random.pick(["0", "null", "-1"])};`,
      `  const at = ${middle("low", "high")};`,
      `  ${random.pick(["return split(low, at) + split(at, high);", "const left = split(low, at);\n  const right = split(at, high);\n  return left > right ? left : right;"])}`,
      "};",
      "result = split(0, L.length);",
    ],
    drain: () => [
      `const drained${any} = [];`,
      `const copy${any} = Array.from(L${cast});`,
      `while (${random.pick(["copy.length", "copy.length > 1", "copy.length !== 0"])}) drained.push(copy.${random.pick(["pop", "shift", "pop"])}()${random.pick(["", " ?? 0", "! * 2".replace("!", "")])});`,
      "result = drained;",
    ],
    text: () => [
      `let text = "";`,
      `for (let i = 0; i < L.length; ${up("i")}) text += ${random.pick(["L[i]", 'String(L[i]).padStart(2, "0")', '(i ? "," : "") + L[i]', "String.fromCharCode(97 + (L[i] & 15))"])};`,
      `let back = "";`,
      random.pick([
        "for (let i = text.length; i--; ) back += text[i];",
        "for (let i = text.length - 1; i >= 0; i--) back += text.charAt(i);",
        "for (let i = text.length; i > 0; i--) if (text.charCodeAt(i - 1) !== 44) back += text[i - 1];",
      ]),
      "result = back;",
    ],
  };
  const names = Object.keys(algorithms);
  const chosen: string[] = [];
  const calls: string[] = [];
  for (let index = 0; index < functionCount; index++) {
    const name = random.pick(names);
    chosen.push(name);
    const holder = random.pick(["list", "list", "list", "list", "fixed", "state.list", "kept"]);
    let body = algorithms[name]().flatMap(line => line.split("\n"));
    if (random.chance(0.25)) {
      const other = random.pick(names);
      chosen.push(other);
      body = [...body, "{", ...indent(algorithms[other]().map(line => line.replace(/\bresult = /, "more = "))), "}", "result = [result, more];"]; // prettier-ignore
      body.unshift(`let more${any};`);
    }
    body = body.map(line => line.replace(/\bL\b/g, holder));
    if (hasDisturb && random.chance(0.5)) {
      const counter = ["i", "j", "row", "pass", "room"].find(each => body.some(line => new RegExp(`^ *for \\(let ${each}\\b.*\\{$`).test(line))); // prettier-ignore
      if (counter) {
        const at = body.findIndex(line => new RegExp(`^ *for \\(let ${counter}\\b.*\\{$`).test(line));
        body.splice(at + 1, 0, `  disturb(${holder}, ${counter});`);
      }
    }
    if (random.chance(0.2)) body.push(random.pick(["state.sum += turns++;", "best = result;", "state.at = result;", "turns += list.length;"])); // prettier-ignore
    const head = `(list${elementType}, count${number})${any}`;
    const text = [
      `let result${any};`,
      ...(holder === "kept" ? [`const kept${elementType} = list;`] : []),
      ...body,
      "return result;",
    ];
    if (random.chance(0.2)) lines.push(`const work${index} = ${head} => {`, ...indent(text), "};");
    else lines.push(`function work${index}${head} {`, ...indent(text), "}");
    const count = () => random.pick(["1", "2", "3", "4", "5"]);
    for (let call = 1 + random.below(4); call > 0; call--) calls.push(`work${index}(${random.chance(0.8) ? listOf() : random.pick(["fixed", "state.list"])}, ${count()})`); // prettier-ignore
  }
  const isLooped = random.chance(0.3);
  for (const call of calls)
    lines.push(
      "try {",
      ...(isLooped
        ? [`  for (let round = 0; round < ${2 + random.below(3)}; round++) console.log(show(${call}));`]
        : [`  console.log(show(${call}));`]),
      "} catch (error) {",
      `  console.log("threw", (error${isTyped ? " as any" : ""}).name);`,
      "}",
    );
  lines.push("console.log(turns, show(best), show(state.sum), show(state.list), show(state.at), show(fixed));");
  const ownNames = /\b(?:work\d|turns|best|state|fixed|show|disturb)\b/g;
  return {
    name: [...new Set(chosen)].join("-"),
    lines: lines
      .flatMap(line => line.split("\n"))
      .map(line => line.replaceAll("console.log(", print + "("))
      .map(line => (suffix ? line.replace(ownNames, name => name + suffix) : line)),
  };
}
export const writeSceneOfListAlgorithms = (random: () => number, n: number, isTypeScript: boolean): string[] =>
  writeListAlgorithms(random, isTypeScript, "printValue", "_" + n).lines;
