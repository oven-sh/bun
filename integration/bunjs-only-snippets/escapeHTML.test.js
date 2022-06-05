import { describe, it, expect } from "bun:test";
import { gcTick } from "./gc";

describe("escapeHTML", () => {
  it("works", () => {
    expect(escapeHTML("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;"
    );
    expect(escapeHTML("<")).toBe("&lt;");
    expect(escapeHTML(">")).toBe("&gt;");
    expect(escapeHTML("&")).toBe("&amp;");
    expect(escapeHTML("'")).toBe("&#x27;");
    expect(escapeHTML('"')).toBe("&quot;");
    expect(escapeHTML("\n")).toBe("\n");
    expect(escapeHTML("\r")).toBe("\r");
    expect(escapeHTML("\t")).toBe("\t");
    expect(escapeHTML("\f")).toBe("\f");
    expect(escapeHTML("\v")).toBe("\v");
    expect(escapeHTML("\b")).toBe("\b");
    expect(escapeHTML("\u00A0")).toBe("\u00A0");

    // The matrix of cases we need to test for:
    // 1. Works with short strings
    // 2. Works with long strings
    // 3. Works with latin1 strings
    // 4. Works with utf16 strings
    // 5. Works when the text to escape is somewhere in the middle
    // 6. Works when the text to escape is in the beginning
    // 7. Works when the text to escape is in the end
    // 8. Returns the same string when there's no need to escape
    expect(escapeHTML("lalala" + "<script>alert(1)</script>" + "lalala")).toBe(
      "lalala&lt;script&gt;alert(1)&lt;/script&gt;lalala"
    );

    expect(escapeHTML("<script>alert(1)</script>" + "lalala")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;lalala"
    );
    expect(escapeHTML("lalala" + "<script>alert(1)</script>")).toBe(
      "lalala" + "&lt;script&gt;alert(1)&lt;/script&gt;"
    );

    expect(
      escapeHTML(
        ("lalala" + "<script>alert(1)</script>" + "lalala").repeat(900)
      )
    ).toBe("lalala&lt;script&gt;alert(1)&lt;/script&gt;lalala".repeat(900));
    expect(
      escapeHTML(("<script>alert(1)</script>" + "lalala").repeat(900))
    ).toBe("&lt;script&gt;alert(1)&lt;/script&gt;lalala".repeat(900));
    expect(
      escapeHTML(("lalala" + "<script>alert(1)</script>").repeat(900))
    ).toBe(("lalala" + "&lt;script&gt;alert(1)&lt;/script&gt;").repeat(900));
  });
});
