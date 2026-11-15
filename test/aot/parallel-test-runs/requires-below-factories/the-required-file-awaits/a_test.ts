import { test, vi, mock } from "bun:test";
import "./chain";
mock.module("./rate", async () => { let said; try { const c = await import("./chain"); said = c.shared(); } catch (e) { said = e.constructor.name + " " + String(e.message).slice(0, 30); } return { rate: "mock " + said }; });
test("a", async () => { let said; try { said = (await import("./rate")).rate; } catch (e) { said = e.constructor.name; } console.log("SAID a", said); try { said = (await import("./uses")).shared(); } catch (e) { said = e.constructor.name; } console.log("SAID a2", said); });
