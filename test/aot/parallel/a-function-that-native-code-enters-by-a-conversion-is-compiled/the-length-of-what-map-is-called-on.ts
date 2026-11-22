const t = (l: any, r: any) => { try { console.log(l, "gave", r()); } catch (e: any) { console.log(l, "threw", e.name); } };
t("map", () => Array.prototype.map.call({ get length() { console.log("ran"); return 0; } } as any, 7 as any));
