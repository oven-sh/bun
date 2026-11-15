import { test, vi, mock } from "bun:test";
import "./rate.cjs";
mock.module("./rate.cjs", async original => { let said; try { await import("./chain"); const c = await import("./uses"); said = c.shared(); } catch (e) { said = e.constructor.name + " " + String(e.message).slice(0, 30); } return { rate: "mock " + said }; });
test("a", async () => { let said; try { said = (await import("./rate.cjs")).rate; } catch (e) { said = e.constructor.name; } console.log("SAID a", said); try { said = (await import("./uses")).shared(); } catch (e) { said = e.constructor.name; } console.log("SAID a2", said); });
