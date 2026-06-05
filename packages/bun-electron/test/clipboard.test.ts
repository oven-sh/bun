// Ported from Electron's spec/api-clipboard-spec.ts (text/html/rtf/formats).

import { beforeEach, describe, expect, test } from "bun:test";
import { clipboard } from "../src/index.ts";

beforeEach(() => clipboard.clear());

describe("clipboard module", () => {
  describe("clipboard.readText()/writeText()", () => {
    test("returns recently written text", () => {
      clipboard.writeText("test");
      expect(clipboard.readText()).toBe("test");
    });

    test("does not modify the text on read", () => {
      clipboard.writeText("Hello");
      expect(clipboard.readText()).toBe("Hello");
      expect(clipboard.readText()).toBe("Hello");
    });
  });

  describe("clipboard.readHTML()/writeHTML()", () => {
    test("returns recently written HTML", () => {
      clipboard.writeHTML("<b>Hi</b>");
      expect(clipboard.readHTML()).toBe("<b>Hi</b>");
    });
  });

  describe("clipboard.readRTF()/writeRTF()", () => {
    test("returns recently written RTF", () => {
      clipboard.writeRTF("{\\rtf1\\ansi}");
      expect(clipboard.readRTF()).toBe("{\\rtf1\\ansi}");
    });
  });

  describe("clipboard.write()", () => {
    test("writes multiple formats at once", () => {
      clipboard.write({ text: "hi", html: "<i>hi</i>" });
      expect(clipboard.readText()).toBe("hi");
      expect(clipboard.readHTML()).toBe("<i>hi</i>");
    });
  });

  describe("clipboard.availableFormats()", () => {
    test("reflects written formats", () => {
      clipboard.writeText("t");
      clipboard.writeHTML("<p>h</p>");
      const formats = clipboard.availableFormats();
      expect(formats).toContain("text/plain");
      expect(formats).toContain("text/html");
    });
  });

  describe("clipboard.clear()", () => {
    test("clears the clipboard", () => {
      clipboard.writeText("something");
      clipboard.clear();
      expect(clipboard.readText()).toBe("");
      expect(clipboard.availableFormats()).toEqual([]);
    });
  });

  describe("clipboard.readBookmark()/writeBookmark()", () => {
    test("round-trips a bookmark", () => {
      clipboard.writeBookmark("Bun", "https://bun.com");
      expect(clipboard.readBookmark()).toEqual({ title: "Bun", url: "https://bun.com" });
    });
  });
});
