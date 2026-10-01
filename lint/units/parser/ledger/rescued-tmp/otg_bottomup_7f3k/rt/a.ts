const d = (v: any, _c: any) => v;
export default @d class C {}
try { console.log("typeof C:", typeof C); } catch (e) { console.log("error:", String(e)); }
