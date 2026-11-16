import { expect, test } from "bun:test";
test("Date.prototype.toISOString is replaced", () => {
  const real = Date.prototype.toISOString;
  Date.prototype.toISOString = () => "replaced";
  let said; try { said = JSON.stringify([new Date(0)]); } catch (error) { said = error.name; } finally { try { Date.prototype.toISOString = real; } catch {} }
  console.error("SEEN toISOString | " + said); expect(said).toBe('["replaced"]');
});
