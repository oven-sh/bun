import https from "node:https";

const agent = new https.Agent();
const certificate = (seed: number): string => "-----BEGIN CERTIFICATE-----\n" + String.fromCharCode(65 + (seed % 26)).repeat(900) + seed + "\n-----END CERTIFICATE-----\n";
const roots: string[] = [];
for (let i = 0; i < 150; i++) roots.push(certificate(i));
const base = { host: "example.test", port: 443 };
const name = (options: object): string => agent.getName({ ...base, ...options });

console.log("short parts are written out:", name({ ca: "ca", cert: "cert", crl: [Buffer.from("c"), Buffer.from("r"), Buffer.from("l")] }));
console.log("a short list is joined:", name({ ca: ["a", "b"] }), name({ ca: [["a"], "b", undefined, null] }));
console.log("the same list twice:", name({ ca: roots }) === name({ ca: roots }));
console.log("a copy of the list:", name({ ca: roots }) === name({ ca: roots.slice() }));
console.log("the same text in other strings:", name({ ca: roots }) === name({ ca: roots.map(text => (" " + text).slice(1)) }));
console.log("buffers with the same text:", name({ ca: roots }) === name({ ca: roots.map(text => Buffer.from(text)) }));
console.log("one certificate fewer:", name({ ca: roots }) === name({ ca: roots.slice(1) }));
console.log("another order:", name({ ca: roots }) === name({ ca: roots.slice().reverse() }));
console.log("one letter changed:", name({ ca: roots }) === name({ ca: roots.map((text, i) => (i === 77 ? text.replace("A", "B").replace("Z", "Y") : text)) }));
console.log("a hole is an empty text:", name({ ca: [roots[0], , roots[1]] }) === name({ ca: [roots[0], undefined, roots[1]] }));
console.log("text beyond ASCII, as a string and as a buffer:", name({ ca: "é".repeat(700) }) === name({ ca: Buffer.from("é".repeat(700)) }));

const changing = roots.slice();
const before = name({ ca: changing });
changing[3] = certificate(1000);
console.log("the list is changed in place:", before === name({ ca: changing }));
changing[3] = roots[3]!;
console.log("and changed back:", before === name({ ca: changing }));

const bytes = Buffer.from(roots.join(""));
const asBuffer = name({ ca: bytes });
console.log("one long buffer, one long string:", asBuffer === name({ ca: roots.join("") }));
bytes[40] = 66;
console.log("the buffer is changed in place:", asBuffer === name({ ca: bytes }));

console.log("ca is not cert:", name({ ca: roots }) === name({ cert: roots }), name({ cert: roots }) === name({ cert: roots.slice() }), name({ crl: roots }) === name({ crl: roots.slice() }));
console.log("the other parts still count:", name({ ca: roots }) === name({ ca: roots, servername: "other.test" }), name({ ca: roots }) === name({ ca: roots, rejectUnauthorized: false }));

const many: string[] = [];
for (let i = 0; i < 200; i++) many.push(name({ ca: [certificate(5000 + i), certificate(6000 + i)] }));
console.log("two hundred lists:", new Set(many).size, many[0] === name({ ca: [certificate(5000), certificate(6000)] }));
console.log("the first list again:", name({ ca: roots }) === name({ ca: roots.slice() }));
