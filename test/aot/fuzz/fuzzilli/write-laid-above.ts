// A program lays a function of its own above an object of the library or the host: on the prototype that `performance`, `process`, an emitter or a stream inherits from. It comes by that prototype through a value, not by a name.
// From then on a call that is spelled like a call of the library enters the program's function, and that function acts on what it is handed: it stores another kind of value, adds or deletes a name, makes a list longer.
// A compiler that knows what the library's own function does with its operands believes that nothing has happened to them.
//
// The scene is put together from tables that do not know of each other: which holder, by which road the program comes by the object above it, which name, what the laid function does, what is handed over,
// how the call is reached, and what the caller reads in front of the call and behind it.

export function writeSceneOfWhatIsLaidAbove(random: () => number, n: number, isTypeScript: boolean): string[] {
  const pick = <T>(from: readonly T[]) => from[Math.floor(random() * from.length)];
  const chance = (percent: number) => random() * 100 < percent;
  const typed = (type: string) => (isTypeScript ? `: ${type}` : "");
  const any = typed("any");
  const loose = (text: string) => (isTypeScript ? `(${text} as any)` : text);

  // The ways from an object to the one above it. Some a compiler follows, some it does not.
  const up = (below: string) =>
    pick([
      `Object.getPrototypeOf(${below})`,
      `Object.getPrototypeOf(${below})`,
      `Reflect.getPrototypeOf(${below})`,
      `${loose(below)}.__proto__`,
      `${loose(below)}["__proto__"]`,
      `[Object.getPrototypeOf(${below})][JSON.parse("0")]`,
      `(({ __proto__: found }${any}) => found)(${below})`,
      `climb${n}(${below})`,
      `chain${n}(${below})[1]`,
      `${loose(`Object.getOwnPropertyDescriptor(Object.prototype, "__proto__")`)}.get.call(${below})`,
      `Object.getPrototypeOf(Object.create(Object.getPrototypeOf(${below})))`,
    ]);
  // The other half of the matter: what the call ANSWERS. A compiler that knows the host's function knows the kind of its result; the program's function in its place answers another kind.
  if (chance(20)) {
    const [below, imports, name, operands, uses] = pick<[string, string[], string, string, string[]]>([
      [`new TextEncoder()`, [], "encode", `"ab"`, [`found.length`, `found[0]`, `typeof found`]],
      [`new TextDecoder()`, [], "decode", `new Uint8Array([97, 98])`, [`found.length`, `found + "!"`, `typeof found`]],
      [`new URL("http://a.example/x")`, [], "toString", ``, [`found.length`, `found + "!"`, `typeof found`]],
      [`new URL("http://a.example/x")`, [], "toJSON", ``, [`found.length`, `typeof found`]],
      [`new URLSearchParams("a=1")`, [], "get", `"a"`, [`found + "!"`, `found === null ? 1 : 0`, `typeof found`]],
      [`new URLSearchParams("a=1")`, [], "has", `"a"`, [`found ? 1 : 0`, `found === true ? 1 : 0`, `typeof found`]],
      [`new Headers({ a: "1" })`, [], "get", `"a"`, [`found + "!"`, `found === null ? 1 : 0`, `typeof found`]],
      [`new Headers({ a: "1" })`, [], "has", `"a"`, [`found ? 1 : 0`, `typeof found`]],
      [`new Blob(["ab"])`, [], "slice", `0, 1`, [`found.size`, `typeof found`]],
      [`new Response("ab")`, [], "clone", ``, [`found.status`, `typeof found`]],
      [`new AbortController()`, [], "abort", ``, [`found === undefined ? 1 : 0`, `typeof found`]],
      [
        `new EventTarget()`,
        [],
        "dispatchEvent",
        `new Event("x")`,
        [`found ? 1 : 0`, `found === true ? 1 : 0`, `typeof found`],
      ],
      [`crypto`, [], "getRandomValues", `new Uint8Array(2)`, [`found.length`, `typeof found`]],
      [`crypto`, [], "randomUUID", ``, [`found.length`, `typeof found`]],
      [`performance`, [], "now", ``, [`found > 0 ? 1 : 0`, `Math.floor(found) >= 0 ? 1 : 0`, `typeof found`]],
      [`Buffer.from("ab")`, [], "toString", ``, [`found.length`, `found + "!"`, `typeof found`]],
      [`Buffer.from("ab")`, [], "readUInt8", `0`, [`found + 1`, `found | 0`, `typeof found`]],
      [`Buffer.from("ab")`, [], "subarray", `0, 1`, [`found.length`, `typeof found`]],
      [
        `new Emitter${n}()`,
        [`import { EventEmitter as Emitter${n} } from "node:events";`],
        "listenerCount",
        `"x"`,
        [`found + 1`, `found | 0`, `typeof found`],
      ],
      [
        `new Emitter${n}()`,
        [`import { EventEmitter as Emitter${n} } from "node:events";`],
        "emit",
        `"x"`,
        [`found ? 1 : 0`, `found === false ? 1 : 0`, `typeof found`],
      ],
      [
        `new Emitter${n}()`,
        [`import { EventEmitter as Emitter${n} } from "node:events";`],
        "eventNames",
        ``,
        [`found.length`, `typeof found`],
      ],
      [`process`, [], "uptime", ``, [`found >= 0 ? 1 : 0`, `typeof found`]],
      [`process`, [], "cwd", ``, [`found.length > 0 ? 1 : 0`, `typeof found`]],
      [`process`, [], "listenerCount", `"x"`, [`found + 1`, `typeof found`]],
    ]);
    const answer = pick([
      `"text"`,
      `"text"`,
      `7`,
      `0.5`,
      `null`,
      `undefined`,
      `{ length: -1, size: -1, status: -1 }`,
      `[1, 2, 3]`,
      `true`,
      `false`,
      `hits${n}`,
      `() => 1`,
      `Symbol.for("made up")`,
      `7n`,
    ]);
    const use = pick(uses);
    // Where the function is laid: on the object above the one that is asked, on one further up, or on the object itself through a value.
    const isShared = /^(?:crypto|performance|process)$/.test(below);
    const road = pick([
      up(isShared ? below : `held${n}`),
      up(isShared ? below : `held${n}`),
      up(below),
      up(up(isShared ? below : `held${n}`)),
      `[${isShared ? below : `held${n}`}][JSON.parse("0")]`,
    ]);
    const laid = pick([
      `function () { hits${n}++; return ${answer}; }`,
      `function () { hits${n}++; return ${answer}; }`,
      `() => { hits${n}++; return ${answer}; }`,
      `function () { return ++hits${n} % 3 ? ${answer} : undefined; }`,
    ]);
    const lays = pick([
      `above${n}.${name} = ${laid};`,
      `above${n}.${name} = ${laid};`,
      `above${n}[${JSON.stringify(name)}] = ${laid};`,
      `Object.defineProperty(above${n}, ${JSON.stringify(name)}, { value: ${laid}, writable: true, configurable: true });`,
      `Object.defineProperty(above${n}, ${JSON.stringify(name)}, { get() { return ${laid}; }, configurable: true });`,
      `Object.assign(above${n}, { ${name}: ${laid} });`,
    ]);
    const asked = isShared ? loose(below) : `held${n}`;
    const asks = pick([
      `function ask${n}()${any} { const found${any} = ${asked}.${name}(${operands}); return ${use}; }`,
      `function ask${n}()${any} { const found${any} = ${asked}.${name}(${operands}); return ${use}; }`,
      `function ask${n}()${any} { let sum${any} = 0; for (let at = 0; at < 3; at++) { const found${any} = ${asked}.${name}(${operands}); sum += ${use}; } return sum; }`,
      `function ask${n}()${any} { const fresh${any} = ${isShared ? below : below}; const found${any} = fresh.${name}(${operands}); return ${use}; }`,
      `const ask${n} = ()${any} => { const found${any} = ${asked}[${JSON.stringify(name)}](${operands}); return ${use}; };`,
    ]);
    const round = (label: string) =>
      `{ let said = ""; for (let turn = 0; turn < ${pick([3, 3, 200])}; turn++) { let answer${any}; try { answer = String(ask${n}()); } catch (error) { answer = ${loose("error")}.name; } if (turn < 3) said += answer + ";"; } printValue("${label} ${n}", said, hits${n}); }`;
    const steady =
      !/randomUUID|"now"|uptime|cwd/.test(JSON.stringify(name)) ||
      use.includes("?") ||
      use.startsWith("typeof") ||
      use === "found.length";
    return [
      ...imports,
      `let hits${n} = 0;`,
      ...(road.includes(`climb${n}(`) ? [`const climb${n} = (from${any})${any} => Object.getPrototypeOf(from);`] : []),
      ...(road.includes(`chain${n}(`)
        ? [
            `function chain${n}(from${any})${typed("any[]")} { const all = []; for (let at = from; at; at = Object.getPrototypeOf(at)) all.push(at); return all; }`,
          ]
        : []),
      ...(isShared ? [] : [`const held${n}${any} = ${below};`]),
      asks,
      ...(steady && chance(50) ? [round("answers otherwise, in front")] : []),
      `const above${n}${any} = ${road};`,
      `try { ${lays} } catch (error) { printValue("answers otherwise ${n}", String(${loose("error")}.message)); }`,
      round("answers otherwise"),
    ];
  }
  const bare = (on: string) =>
    `(() => { const bare${any} = {}; ${on}.call(bare, "x", () => {}); return Object.getPrototypeOf(bare._events ?? bare); })()`;

  // The holder through which the call goes, the imports that it needs, how it is made, the roads to an object above it, and names that its library functions have. The handed value is the second operand.
  const [holder, imports, made, roads, names] = pick<[string, string[], string[], string[], string[]]>([
    [
      "performance",
      [],
      [],
      [
        up("new EventTarget()"),
        up("new EventTarget()"),
        up(up("performance")),
        `[EventTarget.prototype][JSON.parse("0")]`,
        `${loose("new EventTarget()")}.constructor.prototype`,
      ],
      ["removeEventListener", "removeEventListener", "addEventListener", "made_up"],
    ],
    [
      "process",
      [],
      [],
      [
        up("process"),
        up("process"),
        up(up("process")),
        bare("process.on"),
        bare("process.on"),
        bare("process.once"),
        bare("process.addListener"),
        `${loose("process")}.constructor.prototype`,
      ],
      ["removeListener", "removeListener", "off", "listenerCount", "made_up"],
    ],
    [
      "process",
      [],
      [],
      [bare("process.on"), bare("process.on"), bare("process.prependListener")],
      ["removeListener", "off", "removeAllListeners", "listeners", "rawListeners", "emit", "setMaxListeners"],
    ],
    [
      `emitter${n}`,
      [`import { EventEmitter as Emitter${n} } from "node:events";`],
      [`const emitter${n}${any} = new Emitter${n}();`],
      [
        up(`emitter${n}`),
        up(`emitter${n}`),
        `[Emitter${n}.prototype][JSON.parse("0")]`,
        `emitter${n}`,
        bare(`emitter${n}.on`),
        `emitter${n}.constructor.prototype`,
      ],
      ["removeListener", "off", "listenerCount", "emit", "made_up"],
    ],
    [
      `signal${n}`,
      [],
      [`const signal${n}${any} = new AbortController().signal;`],
      [up(up(`signal${n}`)), up("new EventTarget()"), up(`signal${n}`), `signal${n}`],
      ["removeEventListener", "addEventListener"],
    ],
    [
      `stream${n}`,
      [`import { Readable as Readable${n} } from "node:stream";`],
      [`const stream${n}${any} = new Readable${n}({ read() {} });`],
      [up(`stream${n}`), up(up(`stream${n}`)), up(up(up(`stream${n}`))), `stream${n}`, bare(`stream${n}.on`)],
      ["removeListener", "off", "unpipe", "made_up"],
    ],
    [
      `server${n}`,
      [`import http${n} from "node:http";`],
      [`const server${n}${any} = http${n}.createServer();`],
      [up(`server${n}`), up(up(`server${n}`)), up(up(up(`server${n}`))), `server${n}`, bare(`server${n}.on`)],
      ["removeListener", "off", "listenerCount", "made_up"],
    ],
    [
      `socket${n}`,
      [`import net${n} from "node:net";`],
      [`const socket${n}${any} = new net${n}.Socket();`],
      [up(`socket${n}`), up(up(`socket${n}`)), up(up(up(`socket${n}`))), `socket${n}`, bare(`socket${n}.on`)],
      ["removeListener", "off", "listenerCount", "made_up"],
    ],
  ]);
  // One scene of five lays a new name that the language or the library looks up by itself. A lock that takes a made-up name has refused these.
  const name = chance(20)
    ? pick(["then", "toJSON", "next", "return", "throw", "valueOf", "inspect", "made_up"])
    : pick(names);
  const road = pick(roads);

  // What is handed over, how a fresh one is made, and what the caller can read of it as a number or a short text.
  const [fresh, reads, deeds] = pick<[string, string[], string[]]>([
    [
      `{ n: seed, m: 1 }`,
      [`target.n`, `target.n`, `target.m`, `Object.keys(target).length`, `typeof target.n`],
      [
        `target.n = target.n + 10;`,
        `target.n = target.n + 10;`,
        `target.n = \`\${target.n}\` + 10;`,
        `target.n = target.n + 0.5;`,
        `target.n = null;`,
        `target.extra = 1;`,
        `delete target.m;`,
        `target.n = target.n + 10; target.extra = 1; delete target.m;`,
        `Object.defineProperty(target, "n", { get() { return 77; }, configurable: true });`,
        `Object.setPrototypeOf(target, { far: 1 });`,
        `Object.freeze(target);`,
      ],
    ],
    [
      `[seed, 2, 3]`,
      [`target[0]`, `target[0]`, `target.length`, `target.length`, `target[target.length - 1]`, `typeof target[0]`],
      [
        `target.push(7);`,
        `target["push"](7);`,
        `target[0] = target[0] + 10;`,
        `target[0] = target[-1] + 10;`,
        `target[0] = "text";`,
        `target[0] = 0.5;`,
        `target.length = 0;`,
        `target.length = 1;`,
        `target[9] = 1;`,
        `delete target[0];`,
        `target.pop(); target.pop();`,
        `target.reverse();`,
        `target.fill(null);`,
      ],
    ],
    [
      `new Float64Array([seed, 2, 3])`,
      [`target[0]`, `target[0]`, `target.length`, `target[2]`],
      [
        `target[0] = target[0] + 10;`,
        `target[0] = NaN;`,
        `target.fill(9);`,
        `target.reverse();`,
        `target.set([5], 1);`,
      ],
    ],
    [
      `new Pair${n}(seed)`,
      [`target.n`, `target.n`, `target.twice()`, `Object.keys(target).length`],
      [
        `target.n = target.n + 10;`,
        `target.n = "text";`,
        `target.extra = 1;`,
        `delete target.n;`,
        `target.twice = () => -1;`,
        `Object.setPrototypeOf(target, { twice() { return -2; } });`,
        `Pair${n}.prototype.twice = function () { return -3; };`,
      ],
    ],
    [
      `new Map([[1, seed]])`,
      [`target.get(1)`, `target.size`, `target.has(2) ? 1 : 0`],
      [
        `target.set(1, target.get(1) + 10);`,
        `target.set(2, 2);`,
        `target.delete(1);`,
        `target.clear();`,
        `target.set(1, "text");`,
      ],
    ],
    [
      `() => seed`,
      [`target()`, `target.length`, `typeof target.mark`],
      [`target.mark = 1;`, `Object.defineProperty(target, "length", { value: 5 });`, `hits${n} += target();`],
    ],
  ]);
  const deed = pick(deeds);
  const read = pick(reads);
  const laid = pick([
    `function (${isTypeScript ? "this: any, " : ""}type${any}, target${any}) { hits${n}++; ${deed} }`,
    `function (${isTypeScript ? "this: any, " : ""}type${any}, target${any}) { hits${n}++; ${deed} }`,
    `function (${isTypeScript ? "this: any, " : ""}type${any}, target${any}) { hits${n}++; ${deed} return this; }`,
    `(type${any}, target${any}) => { hits${n}++; ${deed} }`,
    `function (${isTypeScript ? "this: any, " : ""}type${any}, target${any}) { if (++hits${n} % 3 === 0) { ${deed} } }`,
  ]);
  const lays = pick([
    `above${n}.${name} = ${laid};`,
    `above${n}.${name} = ${laid};`,
    `above${n}.${name} = ${laid};`,
    `above${n}[${JSON.stringify(name)}] = ${laid};`,
    `Object.defineProperty(above${n}, ${JSON.stringify(name)}, { value: ${laid}, writable: true, configurable: true });`,
    `Object.assign(above${n}, { ${name}: ${laid} });`,
    // `Reflect.set` says no without a throw where the holder is locked. The store behind it throws, and its words name the member.
    `if (!Reflect.set(above${n}, ${JSON.stringify(name)}, ${laid})) above${n}.${name} = ${laid};`,
  ]);
  const call = pick([
    `${loose(holder)}.${name}("tick", target)`,
    `${loose(holder)}.${name}("tick", target)`,
    `${loose(holder)}.${name}("tick", target)`,
    `${loose(holder)}[${JSON.stringify(name)}]("tick", target)`,
    `${loose(holder)}.${name}.call(${holder}, "tick", target)`,
    `Reflect.apply(${loose(holder)}.${name}, ${holder}, ["tick", target])`,
  ]);
  // A holder that is locked refuses the store, and the words of the refusal name the member: the driver holds that member against what the page lists.
  // How the call is reached from the function that reads.
  const forgets = pick([
    `function forget${n}(target${any}, times${typed("number")})${typed("number")} { ${call}; return times; }`,
    `function forget${n}(target${any}, times${typed("number")})${typed("number")} { ${call}; return times; }`,
    `function forget${n}(target${any}, times${typed("number")})${typed("number")} { let mixed = 7; for (let turn = 0; turn < times; turn++) { mixed = (mixed * 31 + turn) | 0; ${call}; if ((mixed & 3) === 1) mixed = (mixed + 7) | 0; } return mixed; }`,
    `function forget${n}(target${any}, times${typed("number")})${typed("number")} { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; ${call}; return work; }`,
    `const forget${n} = (target${any}, times${typed("number")})${typed("number")} => { try { ${call}; } finally { times++; } return times; };`,
  ]);
  const asks = pick([
    `function ask${n}(seed${typed("number")}, times${typed("number")})${any} { const target${any} = ${fresh}; const before = ${read}; forget${n}(target, times); return String(before) + ">" + String(${read}); }`,
    `function ask${n}(seed${typed("number")}, times${typed("number")})${any} { const target${any} = ${fresh}; const before = ${read}; forget${n}(target, times); return String(before) + ">" + String(${read}); }`,
    `function ask${n}(seed${typed("number")}, times${typed("number")})${any} { const target${any} = ${fresh}; forget${n}(target, times); return ${read}; }`,
    `function ask${n}(seed${typed("number")}, times${typed("number")})${any} { const target${any} = ${fresh}; let sum${any} = 0; for (let at = 0; at < 3; at++) { forget${n}(target, times); sum += ${read}; } return sum; }`,
    `function ask${n}(seed${typed("number")}, times${typed("number")})${any} { const target${any} = ${fresh}; const before = ${read}; ${call}; return String(before) + ">" + String(${read}); }`,
  ]);
  const when = pick(["in front", "in front", "in front", "between"]);
  const laying = [
    `const above${n}${any} = ${road};`,
    `try { ${lays} } catch (error) { printValue("laid above ${n}", String(${loose("error")}.message)); }`,
  ];
  const turns = pick([4, 10, 10, 200]);
  const round = (label: string) => [
    `{ let said${any} = ""; let sum${any} = 0; for (let turn = 0; turn < ${turns}; turn++) { let answer${any}; try { answer = ask${n}(given${n}[turn & 3], given${n}[turn & 3] | 0); } catch (error) { answer = ${loose("error")}.name; } if (turn < 4) said += answer + ";"; sum += String(answer).length; } printValue("${label} ${n}", said, sum, hits${n}); }`,
  ];
  return [
    ...imports,
    `let hits${n} = 0;`,
    ...(road.includes(`climb${n}(`) ? [`const climb${n} = (from${any})${any} => Object.getPrototypeOf(from);`] : []),
    ...(road.includes(`chain${n}(`)
      ? [
          `function chain${n}(from${any})${typed("any[]")} { const all = []; for (let at = from; at; at = Object.getPrototypeOf(at)) all.push(at); return all; }`,
        ]
      : []),
    ...made,
    ...(fresh.startsWith("new Pair")
      ? [
          `class Pair${n} { n${any}; ${isTypeScript ? "[key: string]: any; " : ""}constructor(n${any}) { this.n = n; } twice()${any} { return this.n * 2; } }`,
        ]
      : []),
    ...(when === "in front" ? laying : []),
    forgets,
    asks,
    `const given${n}${typed("number[]")} = JSON.parse("[1,2,3,2]");`,
    ...(when === "between" ? [...round("laid above, in front"), ...laying] : []),
    ...round("laid above"),
    ...(chance(25)
      ? [
          `try { delete above${n}.${name}; } catch (error) { printValue("laid above ${n}", ${loose("error")}.name); }`,
          ...round("laid above, taken away"),
        ]
      : []),
  ];
}
