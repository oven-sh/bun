import { DOMParser } from "@xmldom/xmldom";
import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as txml from "txml";
import xml2js from "xml2js";
import { bench, group, run } from "../runner.mjs";

const isBun = typeof Bun !== "undefined" && Bun.XML;

function sizeLabel(n) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${n}B`;
}

// -- parse inputs --

const small = `<?xml version="1.0" encoding="UTF-8"?>
<user id="42" active="true">
  <name>John Doe</name>
  <email>john@example.com</email>
  <roles><role>admin</role><role>editor</role></roles>
</user>`;

// An S3 ListObjectsV2-style response.
function listing(count) {
  const parts = [
    `<?xml version="1.0" encoding="UTF-8"?>\n<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">\n  <Name>bucket</Name>\n  <Prefix/>\n  <KeyCount>${count}</KeyCount>\n  <MaxKeys>1000</MaxKeys>\n  <IsTruncated>false</IsTruncated>\n`,
  ];
  for (let i = 0; i < count; i++) {
    parts.push(`  <Contents>
    <Key>photos/2024/${i.toString(16)}/image_${i}.jpg</Key>
    <LastModified>2024-01-${String((i % 28) + 1).padStart(2, "0")}T12:00:00.000Z</LastModified>
    <ETag>&quot;${(i * 2654435761).toString(16)}&quot;</ETag>
    <Size>${(i * 7919) % 1000000}</Size>
    <StorageClass>STANDARD</StorageClass>
  </Contents>\n`);
  }
  parts.push(`</ListBucketResult>\n`);
  return parts.join("");
}

// An Atom-feed-style document with mixed content and CDATA.
function feed(count) {
  const parts = [
    `<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n  <title>Example Feed</title>\n  <updated>2024-01-13T18:30:02Z</updated>\n`,
  ];
  for (let i = 0; i < count; i++) {
    parts.push(`  <entry>
    <title type="html">Post number ${i} &amp; other &lt;things&gt;</title>
    <link href="http://example.org/2024/01/${i}" rel="alternate"/>
    <id>urn:uuid:1225c695-cfb8-4ebb-aaaa-${String(i).padStart(12, "0")}</id>
    <updated>2024-01-13T18:30:02Z</updated>
    <summary><![CDATA[<p>Some <b>HTML</b> in entry ${i}, kept verbatim.</p>]]></summary>
    <author><name>Author ${i % 7}</name></author>
  </entry>\n`);
  }
  parts.push(`</feed>\n`);
  return parts.join("");
}

const large = listing(1000);
const mixed = feed(500);

const fxp = new XMLParser({ ignoreAttributes: false, parseTagValue: false });
const parseXml2js = doc => {
  let result;
  xml2js.parseString(doc, (err, r) => {
    if (err) throw err;
    result = r;
  });
  return result;
};

const docs = [
  ["small", small],
  ["S3 listing", large],
  ["Atom feed", mixed],
];
// Real-world files: every *.xml / *.svg in $BUN_XML_BENCH_FIXTURES.
if (process.env.BUN_XML_BENCH_FIXTURES) {
  const dir = process.env.BUN_XML_BENCH_FIXTURES;
  for (const f of readdirSync(dir).sort()) {
    if (/\.(xml|svg)$/.test(f)) docs.push([f, readFileSync(join(dir, f), "utf8")]);
  }
}
const xmldom = new DOMParser();

for (const [label, doc] of docs) {
  group(`parse ${label} (${sizeLabel(doc.length)})`, () => {
    if (isBun) {
      bench("Bun.XML.parse", () => Bun.XML.parse(doc));
      bench("Bun.XML.parse { compact: false }", () => Bun.XML.parse(doc, { compact: false }));
    }
    bench("txml", () => txml.parse(doc));
    bench("fast-xml-parser", () => fxp.parse(doc));
    bench("@xmldom/xmldom DOMParser", () => xmldom.parseFromString(doc, "text/xml"));
    if (doc.length < 512 * 1024) bench("xml2js", () => parseXml2js(doc));
  });
}

// -- stringify --

// Each serializer gets the object its own parser produced ("@" vs "@_"
// attribute keys), so both do the same work.
const bunObject = isBun ? Bun.XML.parse(large) : undefined;
const fxpObject = fxp.parse(large);
const builder = new XMLBuilder({ ignoreAttributes: false });

group(`stringify S3 listing`, () => {
  if (isBun) bench("Bun.XML.stringify", () => Bun.XML.stringify(bunObject));
  bench("fast-xml-parser XMLBuilder", () => builder.build(fxpObject));
});

await run();
