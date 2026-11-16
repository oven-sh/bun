const t = (l: string, r: () => unknown) => { try { console.log(l, "gave", String(r())); } catch (e) { console.log(l, "threw", (e as Error).name); } };
const s: any = new String("./x.js"); s.toString = () => { console.log("ran"); return "./x.js"; }; t("f", () => (Bun as any).cron(s, "* * * * *", 5));
export {};
