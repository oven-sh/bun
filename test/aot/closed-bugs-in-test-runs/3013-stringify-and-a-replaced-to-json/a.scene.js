import { expect, test } from "bun:test";
test("Date.prototype.toJSON is replaced", () => {
  const real = Date.prototype.toJSON;
  Date.prototype.toJSON = () => "replaced";
  let said; try { said = JSON.stringify([new Date(0)]); } catch (error) { said = error.name; } finally { try { Date.prototype.toJSON = real; } catch {} }
  console.error("SEEN toJSON | " + said); expect(said).toBe('["replaced"]');
});
