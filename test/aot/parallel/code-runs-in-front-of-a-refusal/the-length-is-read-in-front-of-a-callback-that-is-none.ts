const t = (l: string, r: () => unknown) => { try { console.log(l, "gave", String(r())); } catch (e) { console.log(l, "threw", (e as Error).name); } };
t("c", () => Array.prototype.map.call({ get length() { console.log("ran"); return 0; } } as any, 7 as any));
export {};
