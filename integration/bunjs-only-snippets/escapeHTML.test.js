import { describe, it, expect } from "bun:test";
import { gcTick } from "./gc";

describe("Bun.escapeHTML", () => {
  it("works", () => {
    expect(Bun.escapeHTML("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;"
    );
    expect(Bun.escapeHTML("<")).toBe("&lt;");
    expect(Bun.escapeHTML(">")).toBe("&gt;");
    expect(Bun.escapeHTML("&")).toBe("&amp;");
    expect(Bun.escapeHTML("'")).toBe("&#x27;");
    expect(Bun.escapeHTML('"')).toBe("&quot;");
    expect(Bun.escapeHTML("\n")).toBe("\n");
    expect(Bun.escapeHTML("\r")).toBe("\r");
    expect(Bun.escapeHTML("\t")).toBe("\t");
    expect(Bun.escapeHTML("\f")).toBe("\f");
    expect(Bun.escapeHTML("\v")).toBe("\v");
    expect(Bun.escapeHTML("\b")).toBe("\b");
    expect(Bun.escapeHTML("\u00A0")).toBe("\u00A0");

    // The matrix of cases we need to test for:
    // 1. Works with short strings
    // 2. Works with long strings
    // 3. Works with latin1 strings
    // 4. Works with utf16 strings
    // 5. Works when the text to escape is somewhere in the middle
    // 6. Works when the text to escape is in the beginning
    // 7. Works when the text to escape is in the end
    // 8. Returns the same string when there's no need to escape
    expect(
      Bun.escapeHTML("lalala" + "<script>alert(1)</script>" + "lalala")
    ).toBe("lalala&lt;script&gt;alert(1)&lt;/script&gt;lalala");

    expect(Bun.escapeHTML("<script>alert(1)</script>" + "lalala")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;lalala"
    );
    expect(Bun.escapeHTML("lalala" + "<script>alert(1)</script>")).toBe(
      "lalala" + "&lt;script&gt;alert(1)&lt;/script&gt;"
    );

    expect(
      Bun.escapeHTML(
        ("lalala" + "<script>alert(1)</script>" + "lalala").repeat(900)
      )
    ).toBe("lalala&lt;script&gt;alert(1)&lt;/script&gt;lalala".repeat(900));
    expect(
      Bun.escapeHTML(("<script>alert(1)</script>" + "lalala").repeat(900))
    ).toBe("&lt;script&gt;alert(1)&lt;/script&gt;lalala".repeat(900));
    expect(
      Bun.escapeHTML(("lalala" + "<script>alert(1)</script>").repeat(900))
    ).toBe(("lalala" + "&lt;script&gt;alert(1)&lt;/script&gt;").repeat(900));
  });
});
