"use strict";
function pick(type) { if (type === "error") return 100; if (type === "x") return 1; return 50; }
function usesPick(n) { let s = 0; for (let i = 0; i < n; i++) s += pick("x"); return s; }
function one() { return 1; }
function guarded(f) { try { return f(); } catch (e) { return 0; } }
function callsGuarded(f, n) { let s = 0, t = 1, u = 2, v = 3; for (let i = 0; i < n; i++) { s += guarded(f) + t; t = u; u = v; v = t + 1; } return s + t + u + v; }
function hasHandlerItself(f, n) { let s = 0; try { for (let i = 0; i < n; i++) s += guarded(f); } catch (e) { s = -1; } return s; }
module.exports = { usesPick, one, callsGuarded, hasHandlerItself };
