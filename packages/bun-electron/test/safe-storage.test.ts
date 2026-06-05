// Ported from Electron's spec/api-safe-storage-spec.ts (round-trip subset).

import { describe, expect, test } from "bun:test";
import { safeStorage } from "../src/index.ts";

describe("safeStorage module", () => {
  test("isEncryptionAvailable returns true", () => {
    expect(safeStorage.isEncryptionAvailable()).toBe(true);
  });

  test("encryptString returns a Buffer that is not the plaintext", () => {
    const encrypted = safeStorage.encryptString("hello world");
    expect(Buffer.isBuffer(encrypted)).toBe(true);
    expect(encrypted.toString("utf8")).not.toContain("hello world");
  });

  test("decryptString round-trips encryptString", () => {
    const secret = "the quick brown fox 🦊 jumps";
    const encrypted = safeStorage.encryptString(secret);
    expect(safeStorage.decryptString(encrypted)).toBe(secret);
  });

  test("round-trips an empty string", () => {
    const encrypted = safeStorage.encryptString("");
    expect(safeStorage.decryptString(encrypted)).toBe("");
  });

  test("encryptString throws for non-string input", () => {
    expect(() => safeStorage.encryptString(42 as never)).toThrow(TypeError);
  });

  test("decryptString throws for non-buffer input", () => {
    expect(() => safeStorage.decryptString("not a buffer" as never)).toThrow(TypeError);
  });

  test("decryptString rejects tampered ciphertext", () => {
    const encrypted = safeStorage.encryptString("important");
    encrypted[encrypted.length - 1] ^= 0xff;
    expect(() => safeStorage.decryptString(encrypted)).toThrow();
  });

  test("decryptString rejects foreign blobs", () => {
    expect(() => safeStorage.decryptString(Buffer.from("garbage data here"))).toThrow(
      /unrecognized ciphertext/,
    );
  });
});
