import { hookLate, hookGauge, hookMark } from "./hooks.mjs";
function tellLate() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; try { return String(hookLate()); } catch (error) { return error.name; } }
function tellGauge() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; try { return String(hookGauge()); } catch (error) { return error.name; } }
function tellMark() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; try { return String(hookMark()); } catch (error) { return error.name; } }
console.log(tellLate(), tellGauge(), tellMark());
