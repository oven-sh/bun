import querystring from "node:querystring";
import { bench, run } from "../runner.mjs";

const q3 = "X-Amz-Expires=900&versionId=abc&x-id=GetObject";
const q7 =
  "Name=a%2Bb&k%2Bv=%21%27%28%29%2A&X-Amz-Expires=86400&X-Amz-Date=20261018T025009Z&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-SignedHeaders=host&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20261018%2Fus-east-1%2Fexecute-api%2Faws4_request";
const q1 = "a=b";
const q100 = Array.from({ length: 100 }, (_, i) => `key${i}=value${i}`).join("&");
const qUtf16 = "name=\u4e2d\u6587&city=M\u00fcnchen&q=%E4%B8%AD";
const qPlus = "first+name=John+Smith&q=hello+world";
const qMalformed = "a=%zz&b=%E4&c=ok";
const qLateMalformed = q100 + "&pct=100%";
const q3Custom = q3.replaceAll("&", ";").replaceAll("=", ":");
const q7Custom = q7.replaceAll("&", ";").replaceAll("=", ":");
const o3 = querystring.parse(q3);
const o7 = querystring.parse(q7);

bench("querystring.parse, 1 pair", () => querystring.parse(q1));
bench("querystring.parse, 3 pairs, no escapes", () => querystring.parse(q3));
bench("querystring.parse, 7 pairs, with %XX escapes", () => querystring.parse(q7));
bench("querystring.parse, 100 pairs", () => querystring.parse(q100));
bench("querystring.parse, 16-bit input", () => querystring.parse(qUtf16));
bench("querystring.parse, '+' in key and value", () => querystring.parse(qPlus));
bench("querystring.parse, malformed escape (fallback)", () => querystring.parse(qMalformed));
bench("querystring.parse, 100 pairs then a malformed escape", () => querystring.parse(qLateMalformed));
bench("querystring.parse, custom separators, 3 pairs", () => querystring.parse(q3Custom, ";", ":"));
bench("querystring.parse, custom separators, 7 pairs with escapes", () => querystring.parse(q7Custom, ";", ":"));
bench("querystring.parse, custom decoder", () => querystring.parse(q7, null, null, { decodeURIComponent: s => s }));
bench("querystring.parse, empty string", () => querystring.parse(""));
bench("querystring.stringify, 3 pairs", () => querystring.stringify(o3));
bench("querystring.stringify, 7 pairs, characters that need escaping", () => querystring.stringify(o7));

await run();
