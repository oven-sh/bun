import { bench, run } from "./runner.mjs";

var obj = {
  "restApiRoot": "/api",
  "host": "0.0.0.0",
  "port": 3000,
  "remoting": {
    "context": false,
    "rest": {
      "handleErrors": false,
      "normalizeHttpPath": false,
      "xml": false,
    },
    "json": {
      "strict": false,
      "limit": "100kb",
    },
    "urlencoded": {
      "extended": true,
      "limit": "100kb",
      boop: {
        "restApiRoot": "/api",
        "host": "0.0.0.0",
        "port": 3000,
        "remoting": {
          "context": false,
          "rest": {
            "handleErrors": false,
            "normalizeHttpPath": false,
            "xml": false,
          },
          "json": {
            "strict": false,
            "limit": "100kb",
          },
          "urlencoded": {
            "extended": true,
            "limit": "100kb",
          },
          "cors": false,
        },
      },
    },
    "cors": false,
  },
};
var big = JSON.stringify(obj);

bench("JSON.parse(obj)", () => {
  globalThis.foo = JSON.parse(big);
});

bench("JSON.stringify(obj)", () => {
  globalThis.bar = JSON.stringify(obj);
});

var long_ascii = `"${"a".repeat(9999)}"`;
bench("JSON.parse(`\"${'a'.repeat(9999)}\"`)", () => {
  globalThis.bar = JSON.parse(long_ascii);
});

const long_emoji = `"${"🥟".repeat(9999)}"`;
bench("JSON.parse(`\"${'🥟'.repeat(9999)}\"`)", () => {
  globalThis.bar = JSON.parse(long_emoji);
});

await run();
