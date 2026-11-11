const t = (l: string, r: () => unknown) => { try { console.log(l, "gave", String(r())); } catch (e) { console.log(l, "threw", (e as Error).name); } };
const KEY: any = { toString() { console.log("ran"); return "x"; } };
t("a", () => Object.defineProperty({}, KEY, 5 as any));
export {};
