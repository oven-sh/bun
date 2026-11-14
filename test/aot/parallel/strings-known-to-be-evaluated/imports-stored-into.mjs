// The evaluated text stores to what the file imports, and the store throws.
import * as path from "node:path";
import { sep as named } from "node:path";
import written from "node:path";
function toName() { return eval("(function () { try { named = 1; } catch (error) { return error.name + named.length; } })")(); }
function toDefault() { return eval("(function () { try { written = 1; } catch (error) { return error.name + typeof written; } })")(); }
function toStar() { return eval("(function () { try { path = 1; } catch (error) { return error.name + typeof path; } })")(); }
function toMember() { return eval("(function () { try { path.sep = 1; } catch (error) { return error.name + path.sep.length; } })")(); }
function toKey() { return eval("(function () { try { path['sep'] += 1; } catch (error) { return error.name + path.sep.length; } })")(); }
function removed() { return eval("(function () { try { delete path.sep; } catch (error) { return error.name + path.sep.length; } })")(); }
function never() { const own = 3; return eval("(function () { if (own > 4) { named = own; path.sep = own; } return own + named.length; })")(); }
function constant() { const own = 3; return eval("(function () { try { own = 4; } catch (error) { return error.name + own; } })")(); }
for (const f of [toName, toDefault, toStar, toMember, toKey, removed, never, constant]) console.log(f.name, f());
