const t = (l: any, r: any) => { try { console.log(l, "gave", r()); } catch (e: any) { console.log(l, "threw", e.name); } };
t("define", () => Object.defineProperty({}, { toString() { console.log("ran"); return "x"; } } as any, 5 as any));
