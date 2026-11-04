function outer(fail: boolean): string { let out = ""; try { if (fail) throw new Error("x"); var held = "set"; out += read(); } catch { out += "caught " + read(); } finally { out += " finally " + read(); } return out; function read(): string { return String(held); } }
console.log(outer(false), "|", outer(true));
