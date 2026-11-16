// How objects are made and filled, as people write it: a constructor that takes options, lays defaults, copies what it was given over them, reads some of it back at once and derives more from that.
// A compiler that plans a layout for each class has to know every way in which a field can come: a store by name, `Object.assign(this, ..)`, a loop over keys, a spread, a field that only some options bring.
//
// The scene is put together from tables that do not know of each other: how the maker is written, how it takes what it is given, what it reads back and derives, what is done to the object or the class
// behind that, with which options it is called, and what is asked of the results.

export function writeSceneOfMakers(random: () => number, n: number, isTypeScript: boolean): string[] {
  const pick = <T>(from: readonly T[]) => from[Math.floor(random() * from.length)];
  const chance = (percent: number) => random() * 100 < percent;
  const typed = (type: string) => (isTypeScript ? `: ${type}` : "");
  const any = typed("any");
  const loose = (text: string) => (isTypeScript ? `(${text} as any)` : text);
  const self = isTypeScript ? "(this as any)" : "this";

  // What the maker lays by itself in front of what it is given.
  const defaults = pick([
    [`${self}.host = null;`],
    [`${self}.host = null;`, `${self}.port = 80;`],
    [`${self}.host = "local";`, `${self}.port = 80;`, `${self}.tags = [];`],
    [`${self}.port = 80;`],
    [],
    [`${self}.s = 1;`],
  ]);
  // How it takes what it is given.
  const takes = pick([
    [`Object.assign(this, given);`],
    [`Object.assign(this, given);`],
    [`Object.assign(this, given);`],
    [`Object.assign(this, { port: 8080 }, given);`],
    [`Object.assign(this, given, { late: true });`],
    [`for (const key in given) ${self}[key] = given[key];`],
    [`for (const key of Object.keys(given)) ${self}[key] = given[key];`],
    [`for (const [key, value] of Object.entries(given)) ${self}[key] = value;`],
    [
      `const { host = "none", port = 1, ...rest } = given;`,
      `${self}.host = host;`,
      `${self}.port = port;`,
      `${self}.rest = rest;`,
    ],
    [`${self}.host = given.host ?? ${self}.host;`, `${self}.port = given.port ?? 443;`],
    [`if (given.host) ${self}.host = given.host;`, `if ("port" in given) ${self}.port = given.port;`],
    [`${self}.all = { ...given };`, `${self}.port = ${self}.all.port;`, `${self}.host = ${self}.all.host;`],
    [`Object.defineProperties(this, Object.getOwnPropertyDescriptors(given));`],
    [`Reflect.ownKeys(given).forEach(key => { ${self}[key] = given[key]; });`],
  ]);
  // What it reads back at once, and what it derives.
  const derives = pick([
    [
      `const secure = ${self}.port === 443;`,
      `const anonymous = ${self}.host === null;`,
      `${self}.url = (secure ? "https" : "http") + "://" + (anonymous ? "localhost" : ${self}.host);`,
    ],
    [
      `const secure = ${self}.port === 443;`,
      `const anonymous = ${self}.host === null;`,
      `${self}.url = (secure ? "https" : "http") + "://" + (anonymous ? "localhost" : ${self}.host);`,
    ],
    [
      `const secure = ${self}.port === 443;`,
      `const anonymous = ${self}.host === null;`,
      `${self}.url = (secure ? "https" : "http") + "://" + (anonymous ? "localhost" : ${self}.host);`,
    ],
    [
      `const secure = ${self}.port === 443;`,
      `const anonymous = ${self}.host === null;`,
      `${self}.url = (secure ? "https" : "http") + "://" + (anonymous ? "localhost" : ${self}.host);`,
    ],
    [`const a = ${self}.port;`, `${self}.twice = a * 2;`],
    [`${self}.kind = typeof ${self}.port + "/" + typeof ${self}.host;`],
    [`${self}.count = Object.keys(this).length;`],
    [`if (${self}.port > 1000) ${self}.high = true;`],
    [`${self}.label = \`\${${self}.host}:\${${self}.port}\`;`],
    [`${self}.describe = () => ${self}.host + ":" + ${self}.port;`],
    [],
  ]);
  const behind = pick([
    [],
    [],
    [],
    [`Object.freeze(this);`],
    [`Object.seal(this);`],
    [`Object.preventExtensions(this);`],
    [`delete ${self}.host;`],
    [`made${n}.push(this);`],
    [`if (given.other) return given.other;`],
  ]);
  const body = [...defaults, ...takes, ...derives, ...behind].join(" ");

  // How the maker is written.
  const declared = isTypeScript ? "[key: string]: any; " : "";
  const odd = pick([
    "",
    "",
    "",
    `static 404() { return "not found"; }`,
    `static 404() { return "not found"; }`,
    `static get 404() { return "not found"; }`,
    `static 404() { return "not found"; } static describe(given${any}) { return "code " + given; }`,
    `static count = 0;`,
    `static of(given${any}) { return new this(given); }`,
    `get summary() { return ${self}.host + "@" + ${self}.port; }`,
    `#hidden = 1; hidden() { return this.#hidden; }`,
    `0 = "zero";`,
    `toJSON() { return { host: ${self}.host, port: ${self}.port }; }`,
    `static { ${loose(`Client${n}`)}.ready = true; }`,
  ]);
  const shape = pick(["class", "class", "class", "class", "heir", "heir", "function", "factory", "literal method"]);
  const [written, make] =
    shape === "class"
      ? [
          [`class Client${n} { ${declared}${odd} constructor(given${any}) { ${body} } }`],
          (given: string) => `new Client${n}(${given})`,
        ]
      : shape === "heir"
        ? [
            [
              `class Base${n} { ${declared}base = 1; constructor(given${any}) { ${pick(["", `${self}.seen = Object.keys(given).length;`, `Object.assign(this, given);`])} } }`,
              `class Client${n} extends Base${n} { ${odd} constructor(given${any}) { super(given); ${body} } }`,
            ],
            (given: string) => `new Client${n}(${given})`,
          ]
        : shape === "function"
          ? [
              [`function Client${n}(${isTypeScript ? "this: any, " : ""}given${any}) { ${body} }`],
              (given: string) => `new ${loose(`Client${n}`)}(${given})`,
            ]
          : shape === "factory"
            ? [
                [
                  `function client${n}(given${any})${any} { return new (class { ${declared}constructor() { ${body} } })(); }`,
                ],
                (given: string) => `client${n}(${given})`,
              ]
            : [
                [
                  `const makers${n}${any} = { make(given${any})${any} { const made${any} = {}; (function (${isTypeScript ? "this: any" : ""}) { ${body} }).call(made); return made; } };`,
                ],
                (given: string) => `makers${n}.make(${given})`,
              ];

  const isAClass = shape === "class" || shape === "heir";
  // What is done to the class behind its declaration.
  const toTheClass =
    shape === "class" || shape === "heir"
      ? pick([
          "",
          "",
          "",
          "",
          `Object.freeze(Client${n});`,
          `Object.seal(Client${n});`,
          `Object.freeze(Client${n}.prototype);`,
          `${loose(`Client${n}.prototype`)}.port = 1;`,
          `${loose(`Client${n}`)}.extra = 1;`,
        ])
      : "";

  // With which options it is called.
  const options = [
    `{}`,
    `{ port: 443 }`,
    `{ port: 443 }`,
    `{ host: "a.example" }`,
    `{ host: "a.example", port: 8080 }`,
    `{ port: "443" }`,
    `{ port: 443.5, host: undefined }`,
    `{ extra: [1], port: 1 }`,
    `{ host: null, port: null }`,
    `JSON.parse('{"port":443,"host":"b.example"}')`,
    `JSON.parse('{"more":1}')`,
    `{ get port() { return 443; } }`,
    `{ 0: "zero", port: 2 }`,
    `Object.create({ port: 443 })`,
    `{ url: "given", port: 443 }`,
    `[80]`,
  ];
  const calls = Array.from({ length: pick([2, 3, 3, 4]) }, () => pick(options));
  const asks = pick([
    `JSON.stringify(each)`,
    `JSON.stringify(each)`,
    `Object.keys(each).join()`,
    `String(each.url) + "|" + String(each.port) + "|" + String(each.host)`,
    `String(each.url) + "|" + String(each.port) + "|" + String(each.host)`,
    `Object.entries(each).map(([key, value]) => key + "=" + typeof value).join()`,
    `typeof each.port + ":" + ("host" in each) + ":" + Object.isFrozen(each)`,
  ]);
  const how = pick([
    [
      `const all${n}${typed("any[]")} = [${calls.map(make).join(", ")}];`,
      `printValue("makers ${n}", all${n}.map(each => ${asks}).join(" ; "));`,
    ],
    [
      `const all${n}${typed("any[]")} = [${calls.map(make).join(", ")}];`,
      `printValue("makers ${n}", all${n}.map(each => ${asks}).join(" ; "));`,
    ],
    [
      `const all${n}${typed("any[]")} = [];`,
      `for (const given of [${calls.join(", ")}]${isTypeScript ? " as any[]" : ""}) all${n}.push(${make("given")});`,
      `printValue("makers ${n}", all${n}.map(each => ${asks}).join(" ; "));`,
    ],
    [
      `const all${n}${typed("any[]")} = [];`,
      `for (let turn = 0; turn < ${pick([3, 300])}; turn++) { all${n}.length = 0; ${calls.map(given => `all${n}.push(${make(given)});`).join(" ")} }`,
      `printValue("makers ${n}", all${n}.map(each => ${asks}).join(" ; "));`,
    ],
  ]);
  return [
    `const made${n}${typed("any[]")} = [];`,
    ...written,
    ...(toTheClass ? [toTheClass] : []),
    `try {`,
    ...how.map(line => "  " + line),
    `} catch (error) { printValue("makers ${n}", ${loose("error")}.name); }`,
    // To ask for the odd member is to use it, and a member that is used is treated otherwise: mostly nobody asks.
    ...(isAClass && odd.startsWith("static 404") && chance(35)
      ? [`printValue("makers ${n}", ${loose(`Client${n}`)}[404]());`]
      : []),
    ...(isAClass && odd.startsWith("static of")
      ? [`printValue("makers ${n}", typeof Client${n}.of({ port: 5 }).port);`]
      : []),
    `printValue("makers ${n}", made${n}.length);`,
  ];
}
