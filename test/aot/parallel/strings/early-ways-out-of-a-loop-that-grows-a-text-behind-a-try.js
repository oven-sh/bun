const log = [];
function may(x) { if (x === undefined) throw new TypeError("none"); return x; }
function viaSwitch(nodes, limit) { let width = 0, html = ""; for (const node of nodes) { switch (node.kind) { case "text": try { width += node.value.length; } catch (e) { width += 1; } html += node.value; break; } if (width > limit) return "too wide"; } return html; }
function viaIf(nodes, limit) { let width = 0, html = ""; for (const node of nodes) { if (node.kind === "text") { try { width += node.value.length; } catch (e) { width += 1; } html += node.value; } if (width > limit) return "too wide"; } return html; }
function throwsOut(nodes, limit) { let width = 0, html = ""; for (const node of nodes) { if (node.kind === "text") { try { width += node.value.length; } catch (e) { width += 1; } html += node.value; } if (width > limit) throw new RangeError("wide " + width); } return html; }
function breaksOut(nodes, limit) { let width = 0, html = ""; for (const node of nodes) { if (node.kind === "text") { try { width += node.value.length; } catch (e) { width += 1; } html += node.value; } if (width > limit) break; } return html + "|" + width; }
function counted(nodes, limit) { let width = 0, html = ""; for (let i = 0; i < nodes.length; i++) { const node = nodes[i]; if (node.kind === "text") { try { width += may(node.value).length; } catch (e) { width += 1; } html += node.value; } if (width > limit) return "too wide"; } return html; }
function withDefault(nodes, limit) { let width = 0, html = ""; for (const node of nodes) { switch (node.kind) { case "text": try { width += node.value.length; } catch (e) { width += 1; } html += node.value; break; default: html += "<" + node.kind + ">"; } if (width > limit) return "too wide"; } return html; }
function finallyInside(nodes, limit) { let width = 0, html = ""; for (const node of nodes) { if (node.kind === "text") { try { width += node.value.length; } catch (e) { width += 1; } finally { log.push(width); } html += node.value; } if (width > limit) return "too wide"; } return html; }
function twoTexts(nodes, limit) { let width = 0, html = "", kinds = ""; for (const node of nodes) { kinds += node.kind[0]; if (node.kind === "text") { try { width += node.value.length; } catch (e) { width += 1; } html += node.value; } if (width > limit) return kinds; } return html; }
function nested(rows, limit) { let width = 0, html = ""; for (const nodes of rows) { for (const node of nodes) { if (node.kind === "text") { try { width += node.value.length; } catch (e) { width += 1; } html += node.value; } if (width > limit) return "too wide"; } html += ";"; } return html; }
function nineLines(f, K) { let w = ""; for (const x of [0, 1]) { if (!K) { try { f(); } catch {} w += "9"; } if (K) return; } return w; }
const some = [{ kind: "text", value: "ab" }, { kind: "br" }, { kind: "text" }], wide = [{ kind: "br" }, { kind: "text", value: "abcd" }, { kind: "text", value: "e" }];
for (const render of [viaSwitch, viaIf, throwsOut, breaksOut, counted, withDefault, finallyInside, twoTexts]) {
  for (const [nodes, limit] of [[some, 9], [wide, 1], [some, 9], [[], 0], [wide, 4], [some, 2]]) {
    let said; try { said = render(nodes, limit); } catch (e) { said = e.name + ":" + e.message; }
    console.log(render.name, said, log.splice(0).join());
  }
}
console.log(nested([some, wide], 99), nested([some, wide], 3), nested([], 0), nineLines(() => 1, 0), nineLines(() => 1, 1), nineLines(() => { throw 1; }, 0));
