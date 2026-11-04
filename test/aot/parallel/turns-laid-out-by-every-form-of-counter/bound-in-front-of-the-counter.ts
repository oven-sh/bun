function up(n: number): number { let h = 7; for (let i = 0; (n | 0) > i; i++) h = (h * 31 + i) | 0; return h; }
function down(n: number): number { let h = 7; for (let i = n | 0; 0 <= i; i--) h = (h * 31 + i) | 0; return h; }
let said = ""; for (let n = -3; n < 40; n++) said += up(n) + "," + down(n) + " "; console.log(said);
