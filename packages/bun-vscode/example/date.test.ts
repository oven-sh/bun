import { describe, expect, test } from "bun:test";

describe("Date checking", () => {
    test("date is instance of date", () => {
        expect(new Date()).toBeInstanceOf(Date);
    });
});

test("Date can be a string", () => {
    expect(new Date().toString()).toBeString();
});
