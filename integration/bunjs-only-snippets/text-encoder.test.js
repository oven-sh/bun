import { expect, it, describe } from "bun:test";

const getByteLength = (str) => {
  // returns the byte length of an utf8 string
  var s = str.length;
  for (var i = str.length - 1; i >= 0; i--) {
    var code = str.charCodeAt(i);
    if (code > 0x7f && code <= 0x7ff) s++;
    else if (code > 0x7ff && code <= 0xffff) s += 2;
    if (code >= 0xdc00 && code <= 0xdfff) i--; //trail surrogate
  }
  return s;
};

describe("TextDecoder", () => {
  it("should decode ascii text", () => {
    const decoder = new TextDecoder("latin1");
    expect(decoder.encoding).toBe("windows-1252");
    expect(decoder.decode(new Uint8Array([0x41, 0x42, 0x43]))).toBe("ABC");
    const result = [72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33];
    expect(decoder.decode(Uint8Array.from(result))).toBe(
      String.fromCharCode(...result)
    );
  });

  it("should decode unicode text", () => {
    const decoder = new TextDecoder();

    var text = `❤️ Red Heart`;

    const bytes = [
      226, 157, 164, 239, 184, 143, 32, 82, 101, 100, 32, 72, 101, 97, 114, 116,
    ];
    const decoded = decoder.decode(Uint8Array.from(bytes));
    expect(decoder.encoding).toBe("utf-8");

    for (let i = 0; i < text.length; i++) {
      expect(decoded.charCodeAt(i)).toBe(text.charCodeAt(i));
    }
    expect(decoded).toHaveLength(text.length);
  });

  it("should decode unicode text with multiple consecutive emoji", () => {
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    var text = `❤️❤️❤️❤️❤️❤️ Red Heart`;

    text += ` ✨ Sparkles 🔥 Fire 😀 😃 😄 😁 😆 😅 😂 🤣 🥲 ☺️ 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰`;

    expect(decoder.decode(encoder.encode(text))).toBe(text);

    const bytes = new Uint8Array(getByteLength(text) * 8);
    const amount = encoder.encodeInto(text, bytes);
    expect(decoder.decode(bytes.subarray(0, amount.written))).toBe(text);
  });
});

describe("TextEncoder", () => {
  it("should encode latin1 text", () => {
    const text = "Hello World!";
    const encoder = new TextEncoder();
    const encoded = encoder.encode(text);
    expect(encoded instanceof Uint8Array).toBe(true);
    expect(encoded.length).toBe(text.length);
    const result = [72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33];
    for (let i = 0; i < result.length; i++) {
      expect(encoded[i]).toBe(result[i]);
    }
  });

  it("should encode long latin1 text", () => {
    const text = "Hello World!".repeat(1000);
    const encoder = new TextEncoder();
    const encoded = encoder.encode(text);
    expect(encoded instanceof Uint8Array).toBe(true);
    expect(encoded.length).toBe(text.length);
    expect(new TextDecoder().decode(encoded)).toBe(text);
  });

  it("should encode latin1 rope text", () => {
    var text = "Hello";
    text += " ";
    text += "World!";
    const encoder = new TextEncoder();
    const encoded = encoder.encode(text);
    const into = new Uint8Array(100);
    const out = encoder.encodeInto(text, into);
    expect(out.read).toBe(text.length);
    expect(out.written).toBe(encoded.length);

    expect(encoded instanceof Uint8Array).toBe(true);
    const result = [72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33];
    for (let i = 0; i < result.length; i++) {
      expect(encoded[i]).toBe(result[i]);
      expect(encoded[i]).toBe(into[i]);
    }
    expect(encoded.length).toBe(getByteLength(text));
  });

  it("should encode utf-16 text", () => {
    var text = `❤️ Red Heart
          ✨ Sparkles
          🔥 Fire
      `;
    var encoder = new TextEncoder();
    var decoder = new TextDecoder();
    expect(decoder.decode(encoder.encode(text))).toBe(text);
  });

  // this test is from a web platform test in WebKit
  describe("should use a unicode replacement character for invalid surrogate pairs", () => {
    var bad = [
      {
        encoding: "utf-16le",
        input: [0x00, 0xd8],
        expected: "\uFFFD",
        name: "lone surrogate lead",
      },
      {
        encoding: "utf-16le",
        input: [0x00, 0xdc],
        expected: "\uFFFD",
        name: "lone surrogate trail",
      },
      {
        encoding: "utf-16le",
        input: [0x00, 0xd8, 0x00, 0x00],
        expected: "\uFFFD\u0000",
        name: "unmatched surrogate lead",
      },
      {
        encoding: "utf-16le",
        input: [0x00, 0xdc, 0x00, 0x00],
        expected: "\uFFFD\u0000",
        name: "unmatched surrogate trail",
      },
      {
        encoding: "utf-16le",
        input: [0x00, 0xdc, 0x00, 0xd8],
        expected: "\uFFFD\uFFFD",
        name: "swapped surrogate pair",
      },
    ];

    bad.forEach(function (t) {
      it(t.encoding + " - " + t.name, () => {
        expect(
          new TextDecoder(t.encoding).decode(new Uint8Array(t.input))
        ).toBe(t.expected);
      });
      //   test(function () {
      //     assert_throws_js(TypeError, function () {
      //       new TextDecoder(t.encoding, { fatal: true }).decode(
      //         new Uint8Array(t.input)
      //       );
      //     });
      //   }, t.encoding + " - " + t.name + " (fatal flag set)");
    });
  });

  it("should encode utf-16 rope text", () => {
    var textReal = `❤️ Red Heart
        ✨ Sparkles
        🔥 Fire
    `;
    var a = textReal.split("");
    var text = "";
    for (let j of a) {
      text += j;
    }

    var encoder = new TextEncoder();

    var encoded = encoder.encode(text);

    expect(encoded instanceof Uint8Array).toBe(true);
    const result = [
      226, 157, 164, 239, 184, 143, 32, 82, 101, 100, 32, 72, 101, 97, 114, 116,
      10, 32, 32, 32, 32, 32, 32, 32, 32, 226, 156, 168, 32, 83, 112, 97, 114,
      107, 108, 101, 115, 10, 32, 32, 32, 32, 32, 32, 32, 32, 240, 159, 148,
      165, 32, 70, 105, 114, 101, 10, 32, 32, 32, 32,
    ];
    var len = Math.min(result.length, encoded.length);

    for (let i = 0; i < len; i++) {
      expect(encoded[i]).toBe(result[i]);
    }
    expect(encoded.length).toBe(getByteLength(textReal));
  });
});
