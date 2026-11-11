// Functions of statements of all kinds over the same few variables: numbers, texts, lists, objects, instances, functions, tables, views, generators, control. Where a variable lives (in the function, in the file, in a field) is drawn too.
//
//   bun write-random-mixed-statement-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<seed>-<statements>.mjs, .cjs or .ts
import { mkdirSync, writeFileSync } from "node:fs";

// Statements that stand anywhere; `i` counts. What they leave in a variable is of its kind, but for `any`.
const simple: [kind: string, text: string][] = [
  ["number", "a = (a * 31 + i) | 0;"],
  ["number", "a ^= a >>> 3;"],
  ["number", "a = Math.imul(a, 7) + 1;"],
  ["number", "a += list[i % (list.length || 1)] | 0;"],
  ["number", "a = a % 7;"],
  ["number", "a = ~~b;"],
  ["number", "a <<= 1;"],
  ["number", "a = s.length * 3 - a;"],
  ["number", "a = parseInt(s, 36) | 0;"],
  ["number", "a++;\nb--;"],
  ["number", "a = flag ? a + 1 : -a;"],
  ["number", "a >>>= 1;"],
  ["number", "a = a > 1000 ? 1 : a * a;"],
  ["number", "a = Math.min(a, i, 9);"],
  ["number", "a = Math.floor(b) | 0;"],
  ["double", "b = b / 2 + i;"],
  ["double", "b = Math.max(b, a);"],
  ["double", "b = b > 1e9 ? 0.5 : b * b;"],
  ["double", "b += 0.1;"],
  ["double", "b = Math.sqrt(Math.abs(b));"],
  ["double", "b = a / (i + 1);"],
  ["double", "b = -b;"],
  ["double", "b = Number(s) || b;"],
  ["double", "b %= 3;"],
  ["text", "s += a;"],
  ["text", "s = s.slice(-9);"],
  ["text", "s = `${s}${i}`.slice(0, 12);"],
  ["text", 'if (s.includes("1")) a++;'],
  ["text", 's = s.split("").reverse().join("");'],
  ["text", "a += s.charCodeAt(0) | 0;"],
  ["text", 's = s.padEnd(5, "x");'],
  ["text", 's = s.replace(/\\d/, "d");'],
  ["text", "s = String(any).slice(0, 8);"],
  ["text", "s = s < t ? t : s;"],
  ["text", "t = s + t.slice(0, 3);"],
  ["text", "s = s[i] + s.at(-1);"],
  ["text", 's = ["p", s, i].join("-").slice(0, 10);'],
  ["text", "for (const letter of s) a = (a + letter.charCodeAt(0)) | 0;"],
  ["text", "let k1 = 0;\nwhile (k1 < s.length && s[k1] !== t[k1]) k1++;\na += k1;"],
  ["list", "list.push(a);"],
  ["list", "list[i] = b;"],
  ["list", "if (list.length > 9) list.shift();"],
  ["list", "list = list.map(item => item + 1);"],
  ["list", "list = list.filter(item => item > (a & 3));"],
  ["list", "list.sort((first, second) => first - second);"],
  ["list", "list[list.length] = i;"],
  ["list", "list = [...list, a].slice(-12);"],
  ["list", "list.reverse();"],
  ["list", "list.splice(1, 1);"],
  ["list", "b = list.reduce((first, second) => first + second, 0);"],
  ["list", "for (const item of list) a = (a + item) | 0;"],
  ["list", "for (let k2 = 0; k2 < list.length; k2++) list[k2] += k2;"],
  ["list", "for (let k3 = 0; k3 + 1 < list.length; k3 += 2) b += list[k3] - list[k3 + 1];"],
  ["list", "a = list.indexOf(a);"],
  ["list", "list.fill(a, 1);"],
  ["list", "list = list.concat([a, b]).slice(0, 9);"],
  ["list", "if (list.length > 1) [list[0], list[1]] = [list[1], list[0]];"],
  ["list", "const [head = 1, ...tail] = list;\na += head | 0;\nlist = tail;"],
  ["list", "delete list[1];"],
  ["list", "list.length = 3;"],
  ["list", "a += list.length;"],
  ["list", "list = Array.from({ length: 4 }, (_, at) => at * a);"],
  ["list", "list = new Array(3).fill(i);"],
  ["list", "any = list.pop();"],
  ["list", "rows[i % rows.length][1] = a;"],
  ["list", "for (const row of rows) row.push(row.length < 5 ? i : row.pop());"],
  [
    "list",
    "for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) rows[y][x] = (rows[y][x] + a) & 255;",
  ],
  ["list", "mixed.push(any);"],
  ["list", "any = mixed[i % (mixed.length || 1)];"],
  ["list", "if (mixed.length > 6) mixed.length = 2;"],
  ["list", "mixed[0] = flag ? a : s;"],
  ["object", "obj.x = a;"],
  ["object", "obj.y = s;"],
  ["object", "obj[key] = b;"],
  ["object", 'key = key === "x" ? "y" : "x";'],
  ["object", "any = obj[key];"],
  ["object", "obj = { ...obj, x: i };"],
  ["object", "delete obj.y;"],
  ["object", "for (const name in obj) s += name;\ns = s.slice(0, 20);"],
  ["object", "a += Object.keys(obj).length;"],
  ["object", "obj = i % 2 ? { x: a } : { y: b, x: 1 };"],
  ["object", 'if ("y" in obj) a++;'],
  ["object", "obj.z ??= i;"],
  ["object", "const { x: taken, w = 2, ...others } = obj;\na += (taken | 0) + w;\nobj = others;"],
  ["object", "Object.assign(obj, { w: i });"],
  ["object", "any = JSON.stringify(obj);"],
  ["object", "obj = JSON.parse(JSON.stringify(obj));"],
  ["object", "any = Object.entries(obj).length;"],
  ["object", "obj = Object.fromEntries([[key, a], ['v', s]]);"],
  ["object", "any = obj.x?.toString().length ?? 'none';"],
  ["object", "obj.get = () => a;\nany = obj.get();"],
  ["instance", "point.move(a, i);"],
  ["instance", "point = new Point(a, b);"],
  ["instance", "any = point.x;"],
  ["instance", "point.y = a;"],
  [
    "instance",
    "point = i % 3 ? new Point(a, 1) : { x: 1, y: 2, move() {}, size: () => 3, copy: () => new Point(1, i) };",
  ],
  ["instance", "point = point.copy();"],
  ["instance", "any = point.x;\npoint = point.copy();\nif (point.y > 2) a++;"],
  ["instance", "b += point.size();\npoint = point.copy();"],
  ["object", "obj = obj.next ?? { next: obj, x: i };"],
  ["object", "any = obj.x;\nobj = { ...obj, x: a };\nif (obj.x > 2) b++;"],
  ["list", "list = list.toReversed();"],
  ["list", "any = list[0];\nlist = list.slice();\na += list[0] | 0;"],
  ["text", "s = s.trim() + i;"],
  ["function", "fn = fn.bind(null);"],
  ["table", "map = new Map(map);"],
  ["instance", "b += point.size();"],
  ["instance", "Point.count++;"],
  ["instance", "any = point instanceof Point;"],
  ["instance", "point.extra = i;"],
  ["instance", "point = Point.make(a);"],
  ["instance", "any = point.sum;"],
  ["instance", "point.sum = b;"],
  ["instance", "point = new Solid(a, b, i);"],
  ["instance", "for (const name in point) s += name.slice(0, 1);\ns = s.slice(0, 20);"],
  ["instance", "any = point.constructor === Point;"],
  ["instance", "any = new Point(a, b).size() + new Point(b, a).x;"],
  ["instance", "any = { ...point };"],
  ["function", "a = twice(a) | 0;"],
  ["function", "fn = value => value + a;"],
  ["function", "fn = () => a;"],
  ["function", "fn = () => list.length;"],
  ["function", "fn = () => s.length;"],
  ["function", "fn = value => (a += value | 0);"],
  ["function", "a += 2;\na += fn(i) | 0;"],
  ["function", "a = 1;\nany = fn(i);\na = 2;"],
  ["function", "b = a;\nb += +fn(i) || 1;"],
  ["function", "s += a;\ns += fn(i);\ns = s.slice(-9);"],
  ["function", "const read = [() => a, () => b][i & 1];\na++;\nany = read();\na++;"],
  ["function", "any = fn(i);"],
  ["function", "fn = i & 1 ? twice : half;"],
  ["function", "any = fn.call(null, a);"],
  ["function", "any = fn.bind(null, b)();"],
  ["function", "a = steps(i);"],
  ["function", "any = counted(a, b, s);"],
  ["function", "const inner = () => {\n  a++;\n  return a;\n};\nany = inner() + inner();"],
  ["function", "any = [1, 2].map(fn)[1];"],
  ["function", "any = ((first, second = first) => first + second)(a);"],
  ["function", "any = fn.apply(undefined, [a, i]);"],
  ["function", "let turns = 0;\nconst count = () => (turns < 3 ? (turns++, count()) : turns);\na += count();"],
  ["queue", "if (list.length > 1) any = list.shift();\nlist.push(i);"],
  ["queue", "list.unshift(a);\nlist.length = Math.min(list.length, 9);"],
  ["queue", "for (let k5 = 0; k5 < 3 && list.length; k5++) a += list.shift() | 0;"],
  [
    "queue",
    "const waiting = [a, i];\nwhile (waiting.length) {\n  const next = waiting.shift();\n  if (next > 1 && waiting.length < 5) waiting.push(next >> 1);\n  a = (a + next) | 0;\n}",
  ],
  [
    "queue",
    "const wide = Array.from({ length: 70 }, (_, at) => at);\nwhile (wide.length > 3) a = (a + wide.shift()) | 0;",
  ],
  ["queue", "list = Items.from(list.slice(0, 6));\nany = list instanceof Items;"],
  ["pattern", "s = s.replace(/[a-s]+/g, found => found.length);"],
  ["pattern", "any = s.match(/(\\d)(?<rest>.*)/)?.groups?.rest;"],
  ["pattern", "const digit = /\\d/g;\nwhile (digit.test(s)) a++;"],
  ["pattern", "any = [...s.matchAll(/\\w/g)].length;"],
  ["pattern", "any = s.split(/[,1s]/).length;"],
  ["pattern", "const sticky = /[st]/y;\nsticky.lastIndex = i & 1;\nflag = sticky.test(s);\na += sticky.lastIndex;"],
  ["pattern", "any = /^(s|t)?(\\d*)$/.exec(s)?.[2] ?? 'no';"],
  ["pattern", "s = s.replace(/(.)(.)/, '$2$1').slice(0, 12);"],
  ["pattern", "if (/a|b/.test(t)) t = t.toUpperCase();\nelse t = t.toLowerCase();"],
  ["big", "big = (big * 3n + BigInt(i)) & 0xffffn;"],
  ["big", "big = big ** 2n % 1000003n;"],
  ["big", "big = big > 50n ? big >> 1n : big + 7n;"],
  ["big", "a += Number(big & 7n);"],
  ["big", "big = -big;"],
  ["big", "big = BigInt.asIntN(64, big << 3n);"],
  ["big", "any = big / 3n;"],
  ["private", "any = point.hidden?.(i);"],
  ["private", "point = new Locked(a, i);\nb += point.hidden(1);"],
  ["private", "any = Locked.holds(point);"],
  ["private", "point.open = a;\nany = point.open;"],
  ["optional", "any = obj?.x?.y?.z;"],
  ["optional", "any = point.missing?.(a) ?? point?.x;"],
  ["optional", "any = list?.[i]?.toFixed?.(1);"],
  ["optional", "any = any?.length ?? any?.v ?? a;"],
  ["table", "map.set(a & 3, i);"],
  ["table", "any = map.get(i);"],
  ["table", "for (const [name, value] of map) a = (a + name + value) | 0;"],
  ["table", "map.delete(i);"],
  ["table", "set.add(s);\nif (set.size > 5) set.clear();"],
  ["table", "a += set.has(s) ? 1 : 2;"],
  ["table", "any = [...map.keys()].length;"],
  ["table", "map.set(i, (map.get(i) ?? 0) + 1);"],
  ["table", "map.forEach(value => (b += value));"],
  ["view", "bytes[i & 3] = a;"],
  ["view", "a += bytes[1];"],
  ["view", "for (let k4 = 0; k4 < bytes.length; k4++) bytes[k4] ^= i;"],
  ["view", "bytes = new Uint8Array(bytes);"],
  ["view", "floats[i & 1] = b;\nb += floats[0];"],
  ["view", "bytes.set([a, i]);"],
  ["generator", "for (const value of upTo(3)) a += value;"],
  ["generator", "any = upTo(2).next().value;"],
  ["generator", "list = [...upTo(i & 3)];"],
  ["any", "any = null;"],
  ["any", "any = { v: a };"],
  ["any", "any = flag ? a : b;"],
  ["any", "any = a > 2 ? s : list;"],
  ["any", "any ??= a;"],
  ["any", 'if (typeof any === "number") a += any | 0;'],
  ["any", "if (Array.isArray(any)) a += any.length;"],
  ["any", "any = any?.length;"],
  ["any", "any = any + 1;"],
  ["any", "flag = any == a;"],
  ["any", "flag = any === s;"],
  ["any", "any = any ? i : undefined;"],
  ["any", "any = [a, b, any];"],
  ["any", "any = !any;"],
  ["any", "any = typeof any;"],
  ["any", "flag = !flag && a > 1;"],
  ["any", "flag = s > t || list.length < 3;"],
];
// `S` is a list of statements.
const nests: [kind: string, text: string][] = [
  ["if", "if (a > 3) {\n  S\n}"],
  ["if-else", "if (flag) {\n  S\n} else {\n  S\n}"],
  ["if-typeof", 'if (typeof any === "number") {\n  S\n} else if (any) {\n  S\n}'],
  ["switch", "switch (a & 3) {\n  case 0:\n    S\n    break;\n  case 1: {\n    S\n  }\n  default:\n    S\n}"],
  ["switch-text", "switch (key) {\n  case 'x': {\n    S\n    break;\n  }\n  default: {\n    S\n  }\n}"],
  ["try", "try {\n  S\n  if (i === 2) throw new RangeError(s);\n} catch (error) {\n  any = error.name;\n  S\n}"],
  ["finally", "try {\n  S\n} finally {\n  a = a | 0;\n  S\n}"],
  ["counted", "for (let j = 0; j < 3; j++) {\n  S\n}"],
  ["of-list", "for (const item of list.slice(0, 4)) {\n  a = (a + item) | 0;\n  S\n}"],
  ["in-object", "for (const name in obj) {\n  any = obj[name];\n  S\n}"],
  ["of-table", "for (const [name, value] of [...map].slice(0, 4)) {\n  b += value;\n  S\n}"],
  ["while", "let left = 3;\nwhile (left-- > 0) {\n  S\n}"],
  ["do", "let more = 0;\ndo {\n  S\n} while (++more < 2);"],
  [
    "labelled",
    "outer: for (let j = 0; j < 3; j++) {\n  for (let k = 0; k < 2; k++) {\n    if (a & 1) continue outer;\n    S\n    if (b > 9) break outer;\n  }\n}",
  ],
  ["closure", "const part = () => {\n  S\n};\npart();"],
  ["closure-in-loop", "const part = value => {\n  a += value;\n  S\n};\nfor (let j = 0; j < 3; j++) part(j);"],
  ["callback", "list.slice(0, 3).forEach((item, at) => {\n  a = (a + at) | 0;\n  S\n});"],
  ["block", "{\n  let nearest = i;\n  S\n  any = nearest++;\n}"],
  [
    "returned",
    "const part = () => {\n  for (const item of list.slice(0, 5)) {\n    S\n    if (item > 2) return item;\n  }\n  return -1;\n};\nany = part();",
  ],
  ["reversed", "for (let j = list.length - 1; j >= 0 && j > list.length - 5; j--) {\n  b += list[j];\n  S\n}"],
];
// Functions over the variables of the function around them, called in turns. At HERE, behind a first CALL, some variables are declared.
const captured = [
  "const made = {\n  first(i) {\n    S\n    return a;\n  },\n  second: i => {\n    S\n  },\n  get held() {\n    return [obj, any, b];\n  },\n};\nHERE made.first(0);\nfor (let i = 0; i < 5; i++) {\n  any = made.first(i);\n  if (i & 1) made.second(i);\n  made.held;\n}",
  "const make = () => ({\n  first(i) {\n    S\n    return b;\n  },\n  second(i) {\n    S\n    return point;\n  },\n});\nconst one = make();\nconst two = make();\nHERE two.second(0);\nfor (let i = 0; i < 5; i++) {\n  b = one.first(i);\n  any = two.second(i);\n  one.second(i);\n}",
  "class Part {\n  first(i) {\n    S\n    return a;\n  }\n  second(i) {\n    S\n    return this.first(i);\n  }\n}\nconst part = new Part();\nHERE part.first(0);\nfor (let i = 0; i < 4; i++) {\n  any = part.first(i);\n  any = [any, part.second(i)];\n}",
  "function* turns() {\n  for (let i = 0; i < 4; i++) {\n    S\n    yield a;\n  }\n}\nHERE turns().next();\nfor (const turn of turns()) any = turn;",
  "const turn = i => {\n  if (i > 4) return a;\n  S\n  return turn(i + 1);\n};\nHERE turn(4);\nany = turn(0);",
  "let i = 0;\nconst step = () => {\n  S\n  return i++ < 4;\n};\nconst look = () => [obj, point, list.length, b];\nHERE step();\nwhile (step()) any = look();",
  "const whole = m => {\n  for (let i = 0; i < m; i++) {\n    S\n  }\n  return a;\n};\nHERE whole(3);\nfor (let k = 0; k < 4; k++) any = whole(k);",
];
// Its name, what it holds first, its type in a typed program, and a value that is not quite of its kind.
const variables: [name: string, text: string, type: string, odd: string][] = [
  ["a", "1", "number", "0.5"],
  ["b", "0.5", "number", '"2"'],
  ["s", '"s1"', "string", '"\u0100s"'],
  ["t", '"ta"', "string", "String(n)"],
  ["list", "[3, 1, 2]", "number[]", "[0.5, , 2]"],
  ["mixed", '[1, "m", null]', "(number | string | null)[]", "[undefined, {}]"],
  ["rows", "[[1, 2], [3, 4, 5]]", "number[][]", '[[0.5], ["r", 2]]'],
  ["obj", "{ x: 1, y: 2 }", "{ x?: number; y?: any; [key: string]: any }", '{ y: 1, x: "o" }'],
  ["point", "new Point(1, 2)", "Point", "new Solid(1, 0.5, 2)"],
  ["fn", "twice", "(value: number) => number", "value => value"],
  ["key", '"x"', "string", '"y"'],
  ["map", "new Map([[1, 2]])", "Map<number, number>", "new Map([[0.5, 1]])"],
  ["set", 'new Set(["s1"])', "Set<string>", "new Set()"],
  ["bytes", "new Uint8Array(4)", "Uint8Array", "new Uint8Array(2)"],
  ["floats", "new Float64Array(2)", "Float64Array", "new Float32Array(3)"],
  ["flag", "true", "boolean", "0"],
  ["big", "3n", "bigint", "-1n"],
  ["any", "undefined", "unknown", "null"],
];

function write(seed: number): { name: string; text: string } {
  let state = (seed * 2654435761 + 12345) >>> 0 || 1;
  const random = (below: number): number => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state % below;
  };
  for (let turn = 0; turn < 8; turn++) random(2);
  const pick = <T>(from: readonly T[]): T => from[random(from.length)];
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  // Three kinds of statements of a program come often.
  const often = [pick(simple)[0], pick(simple)[0], pick(simple)[0]];
  const frequent = simple.filter(statement => often.includes(statement[0]));
  let statements = 0;
  // Each statement stands in its own block, so that the names it declares are its own.
  const draw = (depth: number, most: number): string => {
    const parts: string[] = [];
    for (let at = 1 + random(most); at > 0; at--) {
      statements++;
      if (depth < 3 && random(5) === 0)
        parts.push(
          `{\n${indent(
            pick(nests)[1]
              .replaceAll("outer", `outer${statements}`)
              .replaceAll(/^( *)S$/gm, (_, by) => indent(draw(depth + 1, 3), by)),
            "  ",
          )}\n}`,
        );
      else {
        const text = random(3) ? pick(frequent)[1] : pick(simple)[1];
        parts.push(/^(const|let) /m.test(text) ? `{\n${indent(text, "  ")}\n}` : text);
      }
    }
    return parts.join("\n");
  };
  const isTyped = seed % 5 < 2;
  const isCommon = !isTyped && seed % 4 === 0;
  const isAsync = !isCommon && seed % 11 === 3;
  const functions = 1 + random(3);
  const bodies: string[] = [];
  const handed: string[] = [];
  for (let at = 0; at < functions; at++) {
    const loop = pick(["for (let i = 0; i < 6; i++) {\n  S\n}", "for (let i = 0; i < n; i++) {\n  S\n}", "let i = 0;\nwhile (i < 5) {\n  S\n  i++;\n}", "for (const i of [0, 1, 2, 3]) {\n  S\n}", "[0, 1, 2].forEach(i => {\n  S\n});", "const i = n;\nS", "for (let i = 40; i > 0; i -= 3) {\n  S\n}", ...captured]); // prettier-ignore
    const isAwaiting = isAsync && !/forEach|=>|\(i\)|function/.test(loop);
    let body = loop.replaceAll(/^( *)S$/gm, (_, by) => indent((random(3) === 0 && isAwaiting ? "any = await any;\n" : "") + draw(0, 9), by)); // prettier-ignore
    // Where each variable lives.
    const places = variables.map(variable => [variable[0], variable[1], random(4), variable[2], variable[3]] as const);
    const used = places.filter(place => new RegExp(`\\b${place[0]}\\b`).test(body));
    const fields = used.filter(place => place[2] === 3 && !["point", "fn"].includes(place[0]));
    for (const field of fields)
      body = body.replaceAll(
        new RegExp(`(?<!(?<!\\.\\.)\\.|[\\w"'\`])${field[0]}\\b(?!["'\`:])`, "g"),
        `state.${field[0]}`,
      );
    const files = used.filter(place => place[2] === 2 && !fields.includes(place));
    const late = body.includes("HERE ")
      ? used.filter(place => place[2] === 1 && !fields.includes(place) && random(3) === 0)
      : [];
    body = body.replace(/HERE (.+);\n/, (_, call) =>
      late.length
        ? `try {\n  if (n ${pick(["> 3", "< 9", "=== 2"])}) ${call};\n} catch (error) {\n  out.push(error.name);\n}\n${late.map(place => `let ${place[0]} = ${place[1]};`).join("\n")}\n`
        : "",
    );
    // What a typed program hands in: a fifth of it is not quite of its type.
    const given = isTyped ? used.filter(place => place[2] === 0) : [];
    handed.push(given.map(place => `, ${random(5) ? place[1] : `${place[4]} as any`}`).join(""));
    let text = [
      `${isAsync ? "async " : ""}function work${at}(n${isTyped ? ": number" : ""}${given.map(place => `, ${place[0]}: ${place[3]}`).join("")}) {`,
      ...(fields.length ? [`  const state = { ${fields.map(field => `${field[0]}: ${field[1]}`).join(", ")} };`] : []),
      ...used.filter(place => place[2] !== 2 && !fields.includes(place) && !given.includes(place) && !late.includes(place)).map(place => `  let ${place[0]}${isTyped ? `: ${place[3]}` : ""} = ${place[1]};`),
      indent(body, "  "),
      `  out.push([${used.filter(place => place[0] !== "fn").map(place => (fields.includes(place) ? `state.${place[0]}` : place[0])).join(", ")}].map(show).join(" ").slice(0, 400));`,
      "}",
    ].join("\n"); // prettier-ignore
    // A variable of the file has a name of its own.
    let isEarly = false;
    for (const place of files) {
      text = text.replaceAll(
        new RegExp(`(?<!(?<!\\.\\.)\\.|[\\w"'\`])${place[0]}\\b(?!["'\`:])`, "g"),
        `${place[0]}Of${at}`,
      );
      // Some stand behind a first call.
      if (random(6) === 0) {
        text = `${text}${isEarly ? "" : `\ntry {\n  ${isAsync ? "await " : ""}work${at}(2${handed[at]});\n} catch (error) {\n  out.push(error.name);\n}`}\nlet ${place[0]}Of${at} = ${place[1]};`;
        isEarly = true;
      } else text = `let ${place[0]}Of${at} = ${place[1]};\n${text}`;
    }
    bodies.push(text);
  }
  const whole = bodies.join("\n");
  const has = (word: RegExp) => word.test(whole);
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    'const show = value => (Array.isArray(value) ? "[" + value.slice(0, 12).map(show) + "]" : typeof value === "number" ? (Object.is(value, -0) ? "-0" : String(value)) : typeof value === "function" ? "f" : typeof value === "bigint" ? value + "n" : value instanceof Map || value instanceof Set ? "{" + [...value].slice(0, 8).map(show) + "}" : ArrayBuffer.isView(value) ? "<" + Array.from(value).map(show) + ">" : typeof value === "object" && value ? "(" + Object.keys(value).slice(0, 9).map(name => name + ":" + (typeof value[name] === "object" ? "o" : show(value[name]))) + ")" : /=>|function|\\) \\{/.test(String(value)) ? "code" : String(value).slice(0, 30));',
    "const out = [];",
    ...(has(/\b(Point|Solid|Locked|point)\b/) || /Solid/.test(handed.join()) ? ["class Point {\n  static count = 0;\n  static make(x) {\n    const made = new Point(x, 0);\n    made.y = x;\n    return made;\n  }\n  constructor(x, y) {\n    this.x = x;\n    this.y = y;\n  }\n  move(x, y) {\n    this.x += x;\n    this.y += y;\n    return this;\n  }\n  size() {\n    return this.x * this.x + +this.y;\n  }\n  copy() {\n    return new Point(this.x, this.y);\n  }\n  get sum() {\n    return +this.x + +this.y;\n  }\n  set sum(value) {\n    this.x = value;\n  }\n}\nclass Solid extends Point {\n  constructor(x, y, z) {\n    super(x, y);\n    this.z = z;\n  }\n  size() {\n    return super.size() + +this.z;\n  }\n}"] : []), // prettier-ignore
    ...(has(/\bLocked\b/) ? ["class Locked extends Point {\n  #own = 1;\n  #list = [];\n  static holds(value) {\n    return value !== null && typeof value === 'object' && #own in value;\n  }\n  hidden(value) {\n    this.#own += value;\n    this.#list.push(value);\n    return this.#own + this.#list.length;\n  }\n  get open() {\n    return this.#own;\n  }\n  set open(value) {\n    this.#own = value;\n  }\n}"] : []), // prettier-ignore
    ...(has(/\bItems\b/) ? ["class Items extends Array {}"] : []),
    ...(has(/\b(twice|fn)\b/) || /twice/.test(handed.join()) ? ["const twice = value => value * 2;"] : []),
    ...(has(/\bhalf\b/) ? ["const half = value => value / 2;"] : []),
    ...(has(/\bsteps\(/) ? ["function steps(n) {\n  return n < 2 ? 1 : steps(n - 1) + 1;\n}"] : []),
    ...(has(/\bcounted\(/) ? ["function counted() {\n  return arguments.length + (arguments[0] | 0);\n}"] : []),
    ...(has(/\bupTo\(/) ? ["function* upTo(n) {\n  for (let at = 0; at < n; at++) yield at;\n}"] : []),
    whole,
    "for (const n of [3, 5]) {",
    ...bodies.map(
      (_, at) =>
        `  try {\n    ${isAsync ? "await " : ""}work${at}(n${handed[at]});\n  } catch (error) {\n    out.push(error.name);\n  }`,
    ),
    "}",
    'console.log(out.join("\\n").slice(0, 3000));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return { name: `${statements}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`, text: lines.join("\n") + "\n" };
}

const padNumber = (index: number) => String(index).padStart(7, "0");
const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? 100), Number(process.argv[5] ?? 1)]; // prettier-ignore
mkdirSync(folder, { recursive: true });
for (let step = 0; step < count; step++) {
  const seed = from + step * stride;
  const program = write(seed);
  writeFileSync(`${folder}/${padNumber(seed)}-${program.name}`, program.text);
}
console.log(count);
