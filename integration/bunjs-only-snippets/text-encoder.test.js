import { expect, it, describe } from "bun:test";

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

  it("should encode latin1 rope text", () => {
    var text = "Hello";
    text += " ";
    text += "World!";
    const encoder = new TextEncoder();
    const encoded = encoder.encode(text);
    expect(encoded instanceof Uint8Array).toBe(true);
    const result = [72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33];
    for (let i = 0; i < result.length; i++) {
      expect(encoded[i]).toBe(result[i]);
    }
    expect(result.length).toBe(encoded.length);
  });

  it("should encode utf-16 text", () => {
    const text = `❤️ Red Heart
      ✨ Sparkles
      🔥 Fire
      `;
    const encoder = new TextEncoder();
    const encoded = encoder.encode(text);
    expect(encoded instanceof Uint8Array).toBe(true);
    const result = [
      226, 157, 164, 239, 184, 143, 32, 82, 101, 100, 32, 72, 101, 97, 114, 116,
      10, 32, 32, 32, 32, 226, 156, 168, 32, 83, 112, 97, 114, 107, 108, 101,
      115, 10, 32, 32, 32, 32, 240, 159, 148, 165, 32, 70, 105, 114, 101, 10,
      32, 32, 32, 32,
    ];
    expect(encoded.length).toBe(result.length);

    for (let i = 0; i < result.length; i++) {
      expect(encoded[i]).toBe(result[i]);
    }
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

    const text2 = `❤️ Red Heart
    ✨ Sparkles
    🔥 Fire
    `;
    // expect(text2).toBe(text);
    // console.log(text2 === text);

    const encoder = new TextEncoder();

    const encoded = encoder.encode(text);
    console.log(text);
    console.log(textReal);

    expect(encoded instanceof Uint8Array).toBe(true);
    const result = [
      226, 157, 164, 239, 184, 143, 32, 82, 101, 100, 32, 72, 101, 97, 114, 116,
      10, 32, 32, 32, 32, 226, 156, 168, 32, 83, 112, 97, 114, 107, 108, 101,
      115, 10, 32, 32, 32, 32, 240, 159, 148, 165, 32, 70, 105, 114, 101, 10,
      32, 32, 32, 32,
    ];
    const len = Math.min(result.length, encoded.length);
    for (let i = 0; i < len; i++) {
      expect(encoded[i]).toBe(result[i]);
    }

    expect(encoded.length).toBe(result.length);
  });

  //   it("should use a unicode replacement character for invalid surrogate pairs", () => {
  //     var bad = [
  //       {
  //         input: "\uD800",
  //         expected: "\uFFFD",
  //         name: "lone surrogate lead",
  //       },
  //       {
  //         input: "\uDC00",
  //         expected: "\uFFFD",
  //         name: "lone surrogate trail",
  //       },
  //       {
  //         input: "\uD800\u0000",
  //         expected: "\uFFFD\u0000",
  //         name: "unmatched surrogate lead",
  //       },
  //       {
  //         input: "\uDC00\u0000",
  //         expected: "\uFFFD\u0000",
  //         name: "unmatched surrogate trail",
  //       },
  //       {
  //         input: "\uDC00\uD800",
  //         expected: "\uFFFD\uFFFD",
  //         name: "swapped surrogate pair",
  //       },
  //       {
  //         input: "\uD834\uDD1E",
  //         expected: "\uD834\uDD1E",
  //         name: "properly encoded MUSICAL SYMBOL G CLEF (U+1D11E)",
  //       },
  //     ];

  //     const encoder = new TextEncoder();
  //     for (var i = 0; i < bad.length; i++) {
  //       const input = encoder.encode(bad[i].input);
  //       const output = encoder.encode(bad[i].expected);
  //       for (let j = 0; j < input.length; j++) {
  //         expect(input[j]).toBe(output[j]);
  //         console.log(input[j], output[j]);
  //       }
  //     }
  //   });
});
